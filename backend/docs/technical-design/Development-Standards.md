# Development Standards

This document establishes the coding conventions, architecture rules, and testing standards for the Hospital Management System.

## 1. Modular Monolith Strictness
We have embraced a **Modular Monolith** architecture using Nx and NestJS. 
While all modules exist in a single repository and run in a single process, they must remain logically isolated.
- **Bounded Contexts**: Never perform database joins across bounded contexts (e.g., joining an `Order` table to a `Patient` table). Treat each module as if it were a distinct microservice.
- **Inter-Module Communication**: If a module requires data from another module, it must inject the corresponding Service (e.g., `PatientsService` inside `EncountersService`) rather than accessing the Repository directly.
- **Nx Linting**: We utilize `@nx/enforce-module-boundaries` to enforce dependency graphs. Do not bypass these lint rules.

## 2. Multi-Tenancy (Data Isolation)
- **Schema-per-Tenant**: Every tenant operates in their own Postgres schema (`tenant_<hospitalId>`).
- **Never hardcode schemas**: Do not pass `schema` configurations statically in Entities. The `TenantConnectionService` dynamically applies `SET search_path TO "tenant_XYZ"` to the active Postgres connection.
- **Audit Compliance**: You must never execute queries outside of the `TenantConnectionService.runInTenantSchema()` boundary unless querying globally shared master data. 

## 3. Asynchronous Events & Lifecycle Hooks
To keep the primary business operations fast and resilient, cross-cutting concerns (Audit Logs, Analytics, Search Indexing) must be decoupled from the core transaction.
- **TypeORM Subscribers**: Use `EntitySubscriberInterface` (e.g., `ReportingSubscriber`).
- **Fire-and-Forget**: Publishers must wrap external/secondary database writes in a `try/catch` block. A failure to write an audit log should **never** roll back a life-saving clinical order.
- **Lifecycle Caveats**: Remember that TypeORM `afterInsert` fires before child entities are saved if the parent service performs sequential `.save()` calls instead of using `cascade: true`. Plan your payload extraction accordingly.

## 4. TypeScript & ESM Rules
- **ES Modules**: The project strictly enforces ESM (`"type": "module"` in `package.json`).
- **File Extensions**: All relative imports in `.ts` files MUST include the `.js` extension. Example: `import { Patient } from './patient.entity.js';`
- **Strict Typing**: Ensure `strict: true` is enabled. Avoid `any` types.

## 5. Testing
We enforce a high standard of integration testing against real databases rather than mocking out Repositories.

### Tenant-scoped integration tests

Every integration spec provisions a real tenant schema and runs against it — there is no
transaction-rollback isolation anywhere in this codebase. Use the shared helper in
`apps/api/src/testing/tenant-test-context.ts`:

```ts
let ctx: TenantTestContext;

beforeAll(async () => {
  ctx = await setupTenantTestContext({ namePrefix: 'my_feature', seedRbac: true });
});

afterAll(() => teardownTenantTestContext(ctx));

it('...', async () => {
  const myService = new MyService(ctx.tenantConnection);
  await ctx.inTenant(() => myService.doSomething());
});
```

`namePrefix` must match `[a-z0-9_]+` (lowercase letters, digits, underscore only — no hyphens):
it becomes part of a real Postgres schema name and is rejected by the tenant-id safety check.

`ctx` exposes `dataSource`, `tenantContext`, `tenantConnection`, `accountsService`, `tenantId`,
`inTenant()` and `createTenant()` — construct any other service under test yourself (as above)
and call it inside `ctx.inTenant()`.

Tenant IDs are sequential and deterministic (`my_feature_1`, `my_feature_2`, ...) — never a
timestamp or random suffix. `setupTenantTestContext()` drops any same-named schema before
provisioning, so a schema left behind by a crashed prior run never collides with the next one.

For tests needing more than one tenant (e.g. isolation tests), call `await ctx.createTenant()` —
it shares the same connection and returns the next sequential tenant ID.

**Audit and reporting subscribers in tests:** both fire on any tracked entity insert regardless
of a test's isolation model, and write into the *same* tenant schema under test — audit via the
main connection pool, reporting via its own dedicated pool (see
`new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`). Both get cleaned up by the same
`teardownTenantTestContext()` call, since they're schema-scoped, not transaction-scoped.

- **Zero-Pollution**: Tests must not leave residual data. Always use the built-in Jest hooks to clean up connections (`app.close()`).

### Specs that resolve services via Nest DI

If your spec boots a module with `Test.createTestingModule(...)` and resolves the service under
test via `moduleRef.get(...)`, wrapping its calls in `ctx.inTenant(...)` does **not** set tenant
context that service can see — you get "No tenant context set". `TenantContextModule` is
`@Global()` and each `TenantContextService` instance owns a *private* `AsyncLocalStorage`, so
`ctx`'s standalone instance and the DI graph's instance are two different stores.

**Default fix — make them the same instance.** When building the `TestingModule`, override the
providers with `ctx`'s objects; `ctx.inTenant()` then works normally for every DI-resolved service:

```ts
const moduleRef = await Test.createTestingModule({ imports: [MyModule] })
  .overrideProvider(DataSource)
  .useValue(ctx.dataSource)
  .overrideProvider(TenantContextService)
  .useValue(ctx.tenantContext)
  .compile();
```

See `apps/api/src/auth/auth.controller.integration-spec.ts` and
`apps/api/src/accounts/audit-wiring.integration-spec.ts`.

**Fallback — only when overriding isn't practical** (the spec genuinely needs the real DI-managed
instances, e.g. it asserts on wiring inside the full `AppModule`): keep the DI-resolved
`TenantContextService`/`TenantConnectionService` and pass only `ctx.tenantId` (or
`<childCtx>.tenantId`) as a plain value into your own `tenantContext.run(...)` calls. See
`apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`. This is the
exception, not the default — annotate the call site so nobody "simplifies" it back to
`ctx.inTenant()`.

## 6. Request Authentication

Every request **except** `POST /auth/login` and `POST /auth/refresh` requires a valid JWT in the
`Authorization: Bearer <token>` header, verified by `AuthContextMiddleware` (in `libs/auth-guards`).
The middleware extracts and validates the token, then stores the decoded claims in `req.authContext` —
this becomes the single source of truth for identity, tenant ID, and permissions downstream.

`req.authContext` is read by:
- `TenantContextMiddleware` — derives the active tenant schema from `req.authContext.hospitalId`
- `RequestContextFactory` — exposes identity and permissions to business logic
- `PermissionGuard` — checks route-level permissions against `req.authContext.permissions`

**Why login and refresh are the exception:**
- `POST /auth/login` has no token yet (it mints one); the middleware accepts an unauthenticated request and allows the controller to read an optional `x-tenant-id` header as a hint for which tenant to authenticate against.
- `POST /auth/refresh` holds a refresh token (from a prior login); the controller decodes it directly and mints a new access token without requiring middleware validation.

**Testing against real tokens:** All controller-style integration specs now mint real JWTs via
`signTestToken()` in `apps/api/src/testing/test-jwt.ts`. This ensures tests exercise the same
auth flow as production — no header-mocking shortcuts.

## 7. Module Boundaries

Two independent, CI-enforced ESLint rules stop cross-module leakage, wired via the `lint` Nx
target (see `.github/workflows/ci.yml`) and configured in one root `eslint.config.mjs`:

**Layer A — real Nx project boundaries.** `@nx/enforce-module-boundaries` governs the 4 actual
Nx projects: `api` (tagged `type:app`) and the 3 shared libraries `@hospital/tenant-context`,
`@hospital/auth-guards`, `@hospital/audit-emitter` (tagged `type:platform-lib`). A platform lib
may depend only on other platform libs — never on `api` — the dangerous direction that would let
shared code reach back into application internals.

**Layer B — domain folders inside `apps/api`.** `apps/api` is a single Nx project containing all
domain modules (`accounts`, `admissions`, `billing`, `patients`, etc.) as plain subdirectories, not
separate Nx projects — Layer A's project-graph-based rule can't see inside it. `eslint-plugin-boundaries`
fills that gap, tagging folders under `apps/api/src` into three tiers:

- `scope:platform` (`app`, `database`, `rbac`, `audit`, `auth`, `testing`) — composition-adjacent
  code (DI wiring, DB/DataSource config, shared test fixtures) that legitimately reads across every
  domain. Restricting what this tier can read isn't the goal; stopping domain-to-domain leakage is.
- `domain:<name>` — one tag per business module. May depend on `scope:platform` and on a short,
  explicit allow-list of sanctioned domain-to-domain edges (see below) — nothing else.
- `scope:reporting` (`reporting`) — the cross-domain read-side event archiver, allowed to depend on
  any domain by design. No domain may depend back on it.

**The sanctioned domain-to-domain allow-list** (every other edge, including each one's reverse, is
rejected):

| From | To |
|---|---|
| `admissions` | `appointments`, `clinical-triage`, `master-data`, `patients` |
| `billing` | `patients` |
| `orders` | `patients` |
| `clinical-triage` | `patients` (test-fixture seeding only) |
| `clinical-vitals` | `patients` (test-fixture seeding only) |

A new domain module added in a future phase must either reuse one of these existing edges or have
the allow-list explicitly extended in code review — that friction is deliberate, not an oversight.

**Verified negative example** (a real, captured `nx lint api` run — a `patients` module file was
temporarily made to import from `admissions`, the reverse of the one sanctioned edge):

```
apps/api/src/patients/patients.service.ts
  1:10  warning  'AdmissionsService' is defined but never used                                                                             @typescript-eslint/no-unused-vars
  1:35  error    There is no policy allowing dependencies from elements of type "domain:patients" to elements of type "domain:admissions"  boundaries/dependencies
```

See `new/docs/superpowers/plans/2026-08-04-nx-module-boundary-enforcement.md` for the full
implementation history, including why the design's original `scope:composition` tier and stricter
platform allow-list were corrected once actually run against the codebase.

## 8. Database-Enforced Tenant Isolation

Every tenant has its own `NOLOGIN` Postgres role, named identically to its schema
(`tenant_<hospitalId>` for both). The app's single DB role (`hospital_db_user`) is granted
membership in every tenant role and uses `SET LOCAL ROLE` — inside a real transaction, not just a
bare query — to scope each request's actual database privileges to one tenant. `SET LOCAL` is a
silent no-op outside an explicit transaction, which is why `TenantConnectionService.runInTenantSchema()`
wraps its work in `startTransaction()`/`commitTransaction()`/`rollbackTransaction()`, not just a
`SET LOCAL ROLE` query tacked onto the previous non-transactional flow.

**Why a role, not just `search_path`:** the old model (one shared role, `SET search_path` only)
could never prove isolation independent of the application — the DB role always had standing
access to every schema, so a bug that set the wrong `search_path` would silently read the wrong
tenant's data instead of failing. With a per-tenant role, the same bug fails closed: the active
role at that point in the transaction only has grants on one schema, so a mismatched `search_path`
just can't find any tables.

**Grant durability — two parts, not one:** `ALTER DEFAULT PRIVILEGES` is set once per tenant role
at provisioning time and covers every table/sequence a *future* migration creates — but it does
NOT retroactively grant the tables the very first migration run just created, since default
privileges only apply to objects created after the `ALTER DEFAULT PRIVILEGES` statement runs. Both
`TenantProvisioningService` (new tenants) and any future one-off backfill need the explicit
`GRANT ALL ON ALL TABLES/SEQUENCES IN SCHEMA ... TO ...` immediately after `runMigrations()`
completes, in addition to the `ALTER DEFAULT PRIVILEGES` setup.

**Real production tenant provisioning didn't exist before this** — `TenantsService.provisionTenant()`
used to only insert a registry row; the actual `CREATE SCHEMA`/migration logic lived only in a
test-only stand-in. `TenantProvisioningService` (`apps/api/src/database/tenant-provisioning.service.ts`)
is now the single shared implementation: create schema → create role → grant USAGE + default
privileges → run every `TENANT_MIGRATIONS` entry via `dataSource.runMigrations()` scoped to that
schema (via a Postgres `-c search_path=...` connection option — TypeORM's own `schema`
DataSourceOption does NOT set the real session search_path for raw migration SQL, only for
generated entity queries) → explicit grant on what the migrations just created → grant
`hospital_db_user` membership in the new role. Both `TenantsService.provisionTenant()` and the test
helper (`apps/api/src/testing/tenant-test-context.ts`) call this one service.

**Migrations split into two tracked sets**, exported from `apps/api/src/database/migrations/index.ts`:
`PLATFORM_MIGRATIONS` (rbac catalog + tenant registry — shared/public-schema tables, run once by
`migrate.ts`) and `TENANT_MIGRATIONS` (everything else — run per-tenant-schema). Every migration
class name needs a 13-digit timestamp suffix for TypeORM's tracked-migration runner to accept it
(`ClassName1234567890123`) — this wasn't true of the original migration files, which only ever ran
via an untracked manual `.up()` replay that bypassed the check entirely.

**Rolling out a new tenant-scoped migration to already-provisioned tenants:**
`pnpm exec nx run api:migrate-tenants` loops every row in the `tenants` registry table and runs
`TENANT_MIGRATIONS` against each schema — TypeORM's per-schema migration tracking means it only
applies what that specific tenant hasn't already seen, so it's safe to run repeatedly and against
every tenant at once. This is what closes the tenant-migration-runner gap `pending-tasks.md`
tracked: before this, nothing in the codebase could apply a new migration to an already-provisioned
tenant schema at all.

See `new/docs/superpowers/plans/2026-08-04-database-enforced-tenant-isolation.md` for the full
implementation history.

## 9. Structured Logging

Every log line is structured JSON (pretty-printed to stdout only in local dev) via `nestjs-pino`,
configured once in `libs/observability`'s `ObservabilityLoggerModule` and wired into `AppModule`.
`main.ts` calls `app.useLogger(app.get(PinoLogger))` right after `NestFactory.create(AppModule,
{ bufferLogs: true })` — every existing `Logger.log/warn/error/debug` call site (including
`@nestjs/common`'s static `Logger.log(...)` calls) automatically routes through it with no changes
needed at the call site.

**Context is automatic, not manual.** A pino `mixin` — not `pinoHttp.customProps` — reads
`TenantContextService.getTenantId()`/`getAccountId()`/`getCorrelationId()` (from
`@hospital/tenant-context`, backed by `AsyncLocalStorage`) on every single log call, including the
automatic HTTP request-completion line pino-http emits. `mixin` is a core pino option that fires on
every write regardless of caller, which is what makes it safe to reason about independently of
NestJS middleware registration order: it just needs a log call to happen somewhere inside the async
chain `TenantContextMiddleware.use()`'s `tenantContext.run({...}, () => next())` kicked off, which
covers all request-handling code by construction. Verified manually against a running dev server:
an inbound `x-correlation-id` header shows up as `correlationId` on both the request-completion log
line and an `ExceptionsHandler` error log line for the same request. A request that never reaches
`TenantContextMiddleware` (e.g. one `AuthContextMiddleware` rejects with 401 before calling `next()`)
correctly has no context fields — there's nothing to attach yet at that point in the chain.

**Convention: log specific fields/IDs, never whole entity objects.** This is a hospital EMR — a
`logger.log(patient)` call can leak PHI through any field that happens to be on the entity,
regardless of the redact list below. Always log `{ patientId: patient.id }`, not `patient` itself.

**Redaction is a backstop, not the primary defense.** `ObservabilityLoggerModule` configures pino's
`redact` option with a fixed key-path list: `password`, `token`, `refreshToken`, `authorization`,
`req.headers.authorization`, `req.headers.cookie`, `ssn`, `dob`, `diagnosis`, `phone`, `email`,
`address` (plus a `*.<key>` wildcard variant of each so it's caught one level into any logged
object). It only catches those specific key names — it cannot substitute for the logging
convention above.

**Config:** `LOG_LEVEL` env var (default `debug` outside production, `info` in production; forced
to `silent` when `NODE_ENV === 'test'`, which Jest sets automatically — so the existing test suite
stays quiet without per-spec configuration).

**Deferred:** the two automated tests this feature calls for (an HTTP request's log line carries
`tenantId`/`correlationId`; a redacted key never appears in emitted output — see
`new/docs/superpowers/specs/2026-08-04-structured-logging-design.md`'s Testing section) were not
written as part of this pass, per the human partner's prototype-demo priority — they're left for
the human partner's own post-prototype testing pass, the same deferral pattern as Phase 1 item 3's
Task 7.

See `new/docs/superpowers/plans/2026-08-04-structured-logging.md` for the full implementation
history. Metrics, tracing, and dashboards (the rest of `new-features.md` #10) are a separate,
not-yet-scheduled follow-up.

## 10. Connection Pooling

The main `DataSource` (`apps/api/src/database/data-source.ts`) has an explicit, env-tunable pool
size and statement timeout: `DB_POOL_MAX` (default `20`, replacing node-postgres's implicit
default of 10) and `DB_STATEMENT_TIMEOUT_MS` (default `30000`, 30 seconds). Both are first-class
`pg` `Pool`/`Client` options passed through TypeORM's `extra` — `pg` issues `SET statement_timeout`
itself right after connecting, unlike `search_path`, which has no first-class option and needs the
connection-string workaround `tenant-migration-data-source.ts` uses instead.

The reporting pool (`apps/api/src/database/reporting-data-source.ts`) is untouched — it already has
its own `max: 3`/`connectionTimeoutMillis: 2000`, and only ever runs simple best-effort
single-table inserts, so a statement timeout adds nothing there.

**These defaults are a placeholder, not a measured number** — `PRD.md` §12 open question #1 (exact
reference server sizing) is still open pending a real load test (`pending-tasks.md` Phase 3 item
9). Both values are env vars specifically so that load test can tune them without a code change.

**Deferred:** true per-tenant connection caps (`new-features.md` #9 calls for "PgBouncer or
equivalent" — a new proxy process this repo has no production infrastructure to run yet) and
tenant-tagged query metrics + noisy-neighbor alerts (needs the Prometheus/Grafana stack already
deferred out of Phase 3 item 6). Both remain open, grouped with their respective existing
follow-ups rather than solved here.

See `new/docs/superpowers/plans/2026-08-04-connection-pool-limits.md` for the full implementation
history.

## 11. Reporting Dashboard Reads

`ReportingQueryService` (`apps/api/src/reporting/reporting-query.service.ts`) reads
`reporting_events` through the **main** connection pool via
`TenantConnectionService.runInTenantSchema()` — the same pattern every other domain service uses
(e.g. `PatientsService`) — never through the dedicated `REPORTING_DATA_SOURCE` pool
`PersistingReportingEventPublisher` writes through. That write pool is deliberately capped at 3
connections so archiver writes never contend with business-transaction connections; a slow
dashboard aggregation query sharing that pool would risk starving the archiver of one of only 3
connections, defeating the reason it's separate at all. Reads getting tenant-role-scoped
(`SET LOCAL ROLE`/`SET LOCAL search_path`) for free via `runInTenantSchema()` is a side effect of
reusing that pattern, not something built specifically for this feature.

**RBAC:** a new `reporting.read` permission gates all three endpoints
(`GET /reporting/events`, `GET /reporting/dashboard/event-counts`,
`GET /reporting/dashboard/revenue`), mapped to `Super Admin`, `Hospital Admin`, and
`Auditor/Compliance` — the first permission the `Auditor/Compliance` role has ever been granted;
it was seeded with zero permissions before this.

**Deferred:** export endpoints (CSV/PDF for government/operational reports) —
`new-features.md` #13's fourth ask — need real product decisions (which formats, for which
audience) this repo hasn't made anywhere yet, so they're a separate future item, not a mechanical
follow-on to the query endpoints here.

See `new/docs/superpowers/plans/2026-08-05-reporting-dashboard-read-apis.md` for the full
implementation history.

## 12. Rate Limiting

`@nestjs/throttler` is registered globally via `APP_GUARD` in `AppModule`, backed by
`@nest-lab/throttler-storage-redis`'s `ThrottlerStorageRedisService`, constructed with Redis
connection **options** (`REDIS_HOST`/`REDIS_PORT` env vars, default `localhost`/`6380`) rather
than a pre-built `ioredis` client — passing a pre-built client means the service's
`onModuleDestroy()` never disconnects it (it only disconnects a client *it* constructed,
tracked via its own `disconnectRequired` flag), which leaked an open Redis connection on every
app shutdown and hung Jest outright for any spec that bootstraps the full `AppModule`. Passing
connection options instead lets the service own the client's full lifecycle. An in-memory store
(the package's default) was rejected because it would let a client get N× the intended limit by
hitting N different Compose replicas once the app scales out (`Deployment-Guide.md` §7).

**Limits:** global default 100 requests/60s per IP everywhere; `POST /auth/login` and
`POST /auth/refresh` override to a stricter 5 requests/60s via `@Throttle()`, since those are the
actual brute-force/credential-stuffing target, not just general traffic. Guards run after Nest's
middleware layer — a request `AuthContextMiddleware` already rejects (e.g. no token on a
protected route) never reaches `ThrottlerGuard` at all, so rate limiting is only observable on
routes a request actually reaches (any excluded-from-auth route, or an authenticated request to
a protected one).

**Test bypass:** both limits raise to `1_000_000` when `NODE_ENV === 'test'` (Jest sets this
automatically). This isn't defensive — several integration spec files independently make real HTTP
requests to `/auth/login` through a bootstrapped Nest app, and since the Redis-backed counter is a
real external store shared across every test file (not reset per file), the combined hits across
the full suite could otherwise trip the 5/60s limit and cause spurious 429s in unrelated tests.

**Corrected:** `PRD.md` §6.2 previously described permissions as living in a "short-TTL Redis cache
of permissions" — not true; permissions are JWT-embedded with a 15-minute TTL, already bounding
staleness without Redis. See that section for the corrected description. A literal Redis
permission cache and a master-data read-through cache (the other two `new-features.md` #11 asks)
remain undelivered — no driving need for either yet.

See `new/docs/superpowers/plans/2026-08-05-redis-rate-limiting.md` for the full implementation
history.

## 13. Object Storage

`@hospital/object-storage` wraps the official `minio` npm package behind one injectable service,
`ObjectStorageService`. Every method takes `(tenantId, key, ...)`, never a raw object key — the
service builds the real key internally as `${tenantId}/${key}`, the same structural-enforcement
pattern `TenantConnectionService.runInTenantSchema()` uses for Postgres (`SET LOCAL ROLE` inside a
real transaction): the caller cannot bypass the tenant prefix by construction, not by convention.

**Single shared bucket** (`OBJECT_STORAGE_BUCKET`, default `hospital-objects`), not
bucket-per-tenant — matches `PRD.md` §9.1's stated design ("MinIO objects are namespaced by
`hospitalId` so tenants share the object store without cross-tenant visibility"). `tenantId` is
validated against `^[a-z0-9_-]+$` before being used in a key prefix; object store keys are opaque
strings, not filesystem paths, so MinIO/S3 never collapses `..` segments the way a real filesystem
would — this validation is defense-in-depth on identifier shape, not a path-traversal fix.

**Scope of this item:** client module + namespace policy + local dev container + a documented
(not yet scripted) backup policy. **Deferred:** generic upload/download REST endpoints — no domain
module in this codebase produces or consumes files yet (DICOM, PDF reports, and Excel exports are
all future Phase 2/6 work), so building a generic "upload anything" endpoint now would mean
guessing its shape with no real caller to validate against. The first domain that actually needs
to store a file wires its own controller directly against `ObjectStorageService`, the same way
`PatientsService` wires against `TenantConnectionService` rather than the platform exposing a
generic "run a query" endpoint. A backup script is deferred the same way — nothing to back up
until a real writer exists (see `Runbook.md`'s Object Storage Backup Policy section).

See `new/docs/superpowers/plans/2026-08-05-minio-object-storage.md` for the full implementation
history.

## 14. Lab/LIS Core Pipeline

The Lab/LIS module (`apps/api/src/lab/`) splits into two controllers/services by concern:
`LabCatalogService`/`LabCatalogController` (category/test/component catalog — create and list
only, gated by `lab.catalog.manage` — Hospital Admin/Super Admin only, mirrors
`master-data.manage`'s admin-only-catalog convention) and `LabWorkflowService`/
`LabWorkflowController` (requisition/sample/result/verify actions, gated by
`lab.requisition.create`/`lab.result.enter`/`lab.result.verify` — Lab Technician's first-ever
permission grants). No update/delete endpoints exist on any catalog entity (category, test, or
component) — catalog corrections currently require direct DB access; see `pending-tasks.md`'s
Lab/LIS entry for this gap.

**Status machine:** `LabRequisition.status` moves `'Pending'` → `'SampleCollected'` →
`'ResultsEntered'` (auto-advanced once every one of the test's `LabTestComponent`s has a
`LabResult` row) → `'Verified'`, plus `'Cancelled'` from any non-terminal state. Each transition
is guarded the same way `OrderItem`'s `completeItem`/`cancelItem` guards its own status — a
`ConflictException` if the current status doesn't allow it.

**Result correction:** re-entering a result for a component that already has one **overwrites**
it via a Postgres `ON CONFLICT ("requisitionId", "componentId") DO UPDATE` upsert, as long as the
requisition isn't `'Verified'` yet — lets a tech fix a data-entry mistake before sign-off. Once
`'Verified'`, `enterResult` is rejected outright; verification is meant to lock the result set it
signs off on.

**No four-eyes enforcement:** the same person can enter a result and then verify it — the old
system's four-eyes/multi-level verification was a per-deployment config toggle
(`VerificationCoreCFGModel`), and no stated need for that configurability exists yet, so this is a
deliberate scope cut, not an oversight.

**Order module untouched:** `OrderItem` still carries a free-text `itemDescription` with no
catalog reference — a `LabRequisition` is the reclassification step, referencing both
`orderItemId` and the catalog `testId` a Lab Technician matches it to. The `Order`/`OrderItem`
entities and the Orders module were not modified by this item.

**Deferred to future items:** report generation/PDF export, machine/instrument (LIS) integration,
external lab send-out, government disease-reporting mapping, auto-calculated derived components,
multi-level verification.

See `new/docs/superpowers/plans/2026-08-05-lab-lis-module.md` for the full implementation
history.

## 15. Radiology Core Pipeline

The Radiology module (`apps/api/src/radiology/`) mirrors Lab/LIS's two-controller split exactly:
`RadiologyCatalogService`/`RadiologyCatalogController` (imaging type/item catalog, gated by
`radiology.catalog.manage` — Hospital Admin/Super Admin only) and `RadiologyWorkflowService`/
`RadiologyWorkflowController` (requisition/scan/report/verify actions, gated by
`radiology.requisition.create`/`radiology.report.enter`/`radiology.report.verify` — Radiology
Technician's first-ever permission grants).

**Structural simplification vs. Lab:** a radiology study produces exactly one narrative report,
not N per-component results — so unlike Lab's `LabResult`, there is no separate report entity.
Report fields (`reportText`, `indication`, `performerId`, `reportEnteredBy`/`At`) live directly
on `RadiologyRequisition`. This means `enterReport` is an ordinary conditional `UPDATE`, not an
`ON CONFLICT` upsert, and `verify` checks `status === 'ReportEntered'` directly with no
coverage-recomputation step — both are simpler by construction than Lab's equivalents, not by
omission.

**Status machine:** `'Pending'` → `'Scanned'` → `'ReportEntered'` → `'Verified'`, plus
`'Cancelled'` from any non-terminal state. Same guard-before-mutate pattern as Lab and `OrderItem`.

**Correctness fixes applied from the start, not as a follow-up:** Lab/LIS's final whole-branch
review found and had to fix (after the fact) a duplicate-requisition race, nested-transaction
pool-starvation risk, and missing row locks. This module's initial migration includes the partial
unique index (`UQ_radiology_requisitions_active_order_item`) from day one, the
existing-requisition check filters `status: Not('Cancelled')` from the start, the
requisition-number generator call is never nested inside the creating transaction, and every
status-transition mutator takes a `pessimistic_write` lock on its initial lookup. The `23505`
catch on `createRequisition` is scoped to the specific constraint name
(`error.constraint === 'UQ_radiology_requisitions_active_order_item'`), not a bare error-code
check — closing the residual gap Lab/LIS's final review parked as a known follow-up rather than
repeating it.

**Order module untouched:** same reclassification pattern as Lab — `OrderItem` still carries
free-text `itemDescription`; `RadiologyRequisition` references both `orderItemId` and the catalog
`imagingItemId` a Radiology Technician matches it to.

**Deferred to future items:** image attachment (`@hospital/object-storage` integration), film
type/quantity billing tracking, DICOM integration (confirmed a wholly separate old-system domain),
report template HTML rendering/PDF export.

**Required-field validation, fixed during final review:** this codebase has no global
`ValidationPipe` and no class-validator decorators on any DTO (a deliberate, existing convention),
so an empty/malformed request body hands the service a DTO whose fields are `undefined` —
which TypeORM's `repository.save()` silently skips rather than rejecting. Lab was accidentally
immune to this because its result writes go through raw SQL `INSERT`s into a separate
`lab_results` table with `NOT NULL` columns; Radiology's "one report per requisition, folded onto
the row" simplification (above) traded away that safety net, since the report columns on
`RadiologyRequisition` must be nullable (they start empty, before any report is entered). Final
review found this let `POST .../report` and `PATCH .../verify` succeed back-to-back on an empty
body, producing a `Verified` requisition with NULL `reportText`/`reportEnteredBy`. Fixed with two
layers: explicit guard clauses at the top of `markScanned`, `enterReport`, and `verify` in
`RadiologyWorkflowService` that throw `BadRequestException` on missing/blank `scannedBy`,
`reportText`/`reportEnteredBy`, and `verifiedBy` respectively (not class-validator, per this
codebase's convention); and a follow-up migration (`0021-add-radiology-requisition-report-checks`)
adding three database-level `CHECK` constraints on `radiology_requisitions` that enforce the same
completeness invariant regardless of code path — so a future raw-SQL script or an added service
method that bypasses these guards still can't leave a `Scanned`/`ReportEntered`/`Verified` row
with its corresponding required fields NULL.

See `new/docs/superpowers/plans/2026-08-05-radiology-module.md` for the full implementation
history.

## 16. Inventory Procurement Pipeline

The Inventory module (`apps/api/src/inventory/`) follows the same two-controller split as Lab/LIS
and Radiology: `InventoryCatalogService`/`InventoryCatalogController` (item category/sub-category/
item/vendor catalog — create and list only, with creation gated by `inventory.catalog.manage` —
Hospital Admin/Super Admin only) and `InventoryProcurementService`/`InventoryProcurementController`
(purchase order create/read/cancel, goods receipt, stock balance query, with writes gated by
`inventory.purchase-order.create`/`inventory.goods-receipt.enter` — Inventory/Store Manager's
first-ever permission grants). `inventory.catalog.manage` gates creation only (the catalog's `POST`
endpoints); every `GET` endpoint across both controllers — catalog listing/lookup and procurement
listing/lookup/stock-balance query alike — is gated by `inventory.read` instead, which
Inventory/Store Manager also holds alongside Hospital Admin/Super Admin. Unlike Lab and Radiology,
there is no requisition step feeding this pipeline from the Order module — procurement starts from
a purchase order against a vendor, not from a clinical order.

**Two partial unique indexes for `stock_batches`, not one plain constraint:** a batch is identified
by `(itemId, batchNumber, expiryDate)`, but `expiryDate` is nullable for non-expiring items.
Postgres treats every `NULL` as distinct for uniqueness purposes, so a single
`UNIQUE ("itemId", "batchNumber", "expiryDate")` constraint would silently allow duplicate batch
rows whenever `expiryDate` is `NULL` — two goods receipts for the same item/batch number with no
expiry would each insert their own row instead of colliding. Migration `0022-create-inventory-
tables` instead declares two `WHERE`-filtered unique indexes:
`UQ_stock_batches_item_batch_expiry` on `("itemId", "batchNumber", "expiryDate") WHERE "expiryDate"
IS NOT NULL`, and `UQ_stock_batches_item_batch_no_expiry` on `("itemId", "batchNumber") WHERE
"expiryDate" IS NULL`. `findOrCreateStockBatch` in `InventoryProcurementService` branches on
`input.expiryDate === null` and issues the matching `INSERT ... ON CONFLICT (...) WHERE ... DO
NOTHING RETURNING *` against whichever partial index applies, then re-`findOne`s on a concurrent-
insert miss to fetch the winning row. Any future module with a similar "identity with an optional
differentiating field" shape (batch/lot numbers, versioned records, anything keyed partly on a
nullable column) should use the same two-partial-index pattern rather than a single column-list
UNIQUE constraint. Batch cost is fixed at first receipt by design — a later goods receipt against
the same batch identity reporting a different `unitCost`/`mrp` does not update the existing row;
this is intentional (already-issued stock stays priced at what it was actually received at), not an
oversight, and is called out with an inline comment at both branches of `findOrCreateStockBatch` so
it isn't "fixed" without also deciding what happens to stock already issued at the old cost. The
`INSERT ... ON CONFLICT DO NOTHING` + fallback-`SELECT` pattern does not depend on transaction
isolation level in the way one might assume: `DO NOTHING` never blocks waiting on a concurrently
uncommitted conflicting row at any isolation level, and the code already handles the
fallback-not-found case (a genuine race where the winning row isn't visible yet) with a clean,
retriable `ConflictException` rather than risking any data corruption.

**Atomic stock balance increment via `ON CONFLICT ... DO UPDATE`:** `recordGoodsReceipt` updates
`stock_balances` with a single raw-SQL upsert — `INSERT INTO stock_balances ("itemId",
"stockBatchId", "availableQuantity") VALUES (...) ON CONFLICT ("itemId", "stockBatchId") DO UPDATE
SET "availableQuantity" = stock_balances."availableQuantity" + excluded."availableQuantity"` —
rather than a read-modify-write (`SELECT` current balance, add in application code, `UPDATE`).
The database performs the addition atomically under the row's own lock, so two concurrent goods
receipts against the same item/batch can't race and drop an increment the way a naive
read-then-write would. Combined with the `pessimistic_write` lock `recordGoodsReceipt` takes on the
purchase order item and purchase order rows up front (same pattern as `cancel`), this is the
module's answer to Lab/Radiology's missing-row-lock lesson (`Development-Standards.md` §15) — the
locking discipline was applied from the start here, not retrofitted after a review finding. Because
the `stock_balances` upsert (and the `stock_batches` inserts in `findOrCreateStockBatch` below) go
through `manager.query()` rather than `repository.save()`, they bypass the repo's `AuditSubscriber`
(which only fires on repository/entity operations) — this is not a lost-audit-trail problem in
practice, since the append-only `stock_transactions` ledger written earlier in the same method (via
`repository.save`, so it IS audited) captures the same event with quantity and `recordedBy`, but
future modules reaching for a raw-query upsert for the same `ON CONFLICT` atomicity should be aware
of this audit blind spot.

**Numeric coercion at the service boundary — a lesson from the fix round:** this codebase has no
global `ValidationPipe` and no class-validator decorators on any DTO (the same deliberate
convention noted in §15), so `RecordGoodsReceiptInput`'s `receivedQuantity`, `unitCost`, and `mrp`
arrive as whatever the raw request body contains — not guaranteed to be numbers, and not guaranteed
to be finite. The first version of `recordGoodsReceipt` used `input.receivedQuantity` directly in
arithmetic and in a parameterized SQL query; a non-numeric or non-finite value (a string, `NaN`,
`Infinity`) would either produce silently wrong stock quantities or fail deep inside the query
rather than at the API boundary. Fixed by explicitly `Number()`-coercing all three fields at the
top of `recordGoodsReceipt`, before any arithmetic or DB access, and range-validating each
(`receivedQuantity` must be finite and positive, `unitCost` finite and non-negative, `mrp` finite
if present) with a `BadRequestException` on failure. **Any future module with unvalidated numeric
DTO fields should follow this same pattern**: coerce with `Number(...)`, check
`Number.isFinite(...)`, and range-check before the value touches arithmetic or a query — the
service method is the only real validation boundary this codebase has for numeric input.

The same fix round also corrected a subtler bug in `findOrCreateStockBatch`: on a successful insert,
the original code built the returned `StockBatch` from the raw `INSERT ... RETURNING *` row via
`repository.create(inserted[0])`, which bypasses TypeORM's column transformers — `expiryDate`'s
`date`-typed column would come back from `node-postgres` as an untransformed value, producing an
off-by-one-day timezone bug for some callers. The fix instead re-fetches the row through
`repository.findOneOrFail({ where: { id: inserted[0].id } })`, so TypeORM's normal `date` transform
(string, not `Date`) applies consistently regardless of whether the row was just inserted or already
existed.

**Explicit scope cuts:** the catalog is create+list only, same convention as Lab/Radiology — no
update/delete endpoints on category, sub-category, item, or vendor. No two-phase "unconfirmed
stock" staging — a goods receipt lands directly in `stock_balances` as available quantity, with no
intermediate pending/quarantine state to confirm before it can be issued. No store/location
dimension — `stock_balances` and `stock_batches` are keyed by `itemId` (and `stockBatchId`) only,
with no warehouse/ward/sub-store column, so all stock for a tenant is a single undifferentiated
pool. No `tenantId` column anywhere in this module's tables — isolation is schema-per-tenant (via
`TenantConnectionService.runInTenantSchema`), consistent with every other domain module in this
codebase, not a row-level tenant filter.

**Deferred to future items:** RFQ/Quotation, two-phase unconfirmed stock staging, store/location
dimension, vendor accounting fields (TDS/ledger/credit period), donations/returns/write-offs,
multi-store/currency/fiscal-year masters, formal PO approval workflow. The immediate next
follow-up is **Item B: internal requisition/dispatch (stock OUT)** — the module that will read from
this pipeline's `stock_balances`/`listStockBalances` to dispatch stock to a department or ward, and
the dependency the Pharmacy module needs before it can be built.

See `new/docs/superpowers/plans/2026-08-05-inventory-procurement.md` for the full implementation
history.

## 17. Inventory Requisition/Dispatch Pipeline

Item B closes the loop Item A (§16) left open: `InventoryRequisitionService`, split across two
controllers — `InventoryRequisitionController` (`inventory/requisitions`, create/read/cancel, gated
by `inventory.requisition.create` for writes and `inventory.read` for `GET`s) and
`InventoryDispatchController` (`inventory/requisitions/items/:id/fulfill`, gated by
`inventory.dispatch.fulfill`). **This is a different two-controller split than Item A's, not a reuse
of the same shape:** Item A's split (§16) is catalog-vs-workflow —
`InventoryCatalogController` for catalog CRUD, `InventoryProcurementController` for both
purchase-order actions *and* goods receipt, all on one controller. Item B instead splits
header-level actions (`InventoryRequisitionController`: create/list/get/cancel) from the
line-level fulfillment action (`InventoryDispatchController`: fulfill only). This was a deliberate
design choice made during this module's brainstorming (approved by the project owner), not a reuse
of Item A's exact controller-split precedent. `inventory.requisition.create` and
`inventory.dispatch.fulfill` are both new first-ever permission grants for Inventory/Store Manager
(and Super Admin), added in migration `0023-create-inventory-requisition-tables` alongside the
`stock_requisitions`/`stock_requisition_items`/`stock_requisition_sequences` tables. `InventoryModule`
had to add `MasterDataModule` to its own `imports` array for this — unlike `DatabaseModule`, which
every Inventory service relies on without an explicit import, `MasterDataModule` is not `@Global()`,
and `createRequisition` needs `MasterDataService.getDepartment` to validate the requester.

**Department-based requester, no Store/location dimension:** a requisition's `departmentId` is
validated against the existing `Department` master-data entity — the same one Lab/Radiology/Order
already reference — not a new Inventory-specific entity. This is consistent with §16's "no
store/location dimension" scope cut: stock is still a single undifferentiated per-tenant pool keyed
by `itemId`/`stockBatchId` only, so fulfillment has no source-warehouse concept to resolve, only a
requesting department to record. The requisition is a genuine two-step flow — `createRequisition`
(status `Pending`) followed by one or more `fulfillRequisitionItem` calls per line (status advances
to `PartiallyFulfilled` then `Fulfilled` once every sibling line's `fulfilledQuantity` reaches its
`requestedQuantity`) — there is no single-call "direct dispatch" that bypasses the requisition
record.

**FEFO batch-walk: a locked, ordered, multi-row query builder, not `repository.find()`:**
`fulfillRequisitionItem` needs to walk every `StockBalance` row for an item, nearest-expiry first,
locking all of them for the duration of the fulfillment. `repository.find()`'s `lock` option only
supports locking the rows of the entity being queried, with no way to control which joined tables a
lock applies to — so this method uses `manager.createQueryBuilder(StockBalance, 'balance')` with an
`innerJoin` to `StockBatch` for the expiry ordering, `.orderBy('batch.expiryDate', 'ASC', 'NULLS
LAST')` tie-broken by `.addOrderBy('batch.createdAt', 'ASC')` then `.addOrderBy('balance.id', 'ASC')`
for deterministic ordering when two batches share an expiry date, and
`.setLock('pessimistic_write', undefined, ['balance'])`. The third argument to `setLock` matters: a
bare `.setLock('pessimistic_write')` on a joined query locks every table named in the `FROM`/`JOIN`
clauses under Postgres (`SELECT ... FOR UPDATE` with no `OF` clause locks all of them), which would
have over-locked `stock_batches` rows this operation only reads and never writes — unnecessarily
serializing unrelated concurrent goods receipts against the same batches. Scoping the lock to the
`balance` alias produces `FOR UPDATE OF "balance"`, locking only the rows this method actually
decrements. Any future module locking a joined query builder should scope `setLock` the same way
unless every joined table genuinely needs locking.

**The `manager.query()` UPDATE-vs-INSERT `RETURNING` shape gotcha — a lesson from this task's fix
round:** §16 already established using `manager.query()` with raw SQL for atomicity outside what
`repository.save()`/`.update()` can express. The decrement here follows that pattern —
`UPDATE stock_balances SET "availableQuantity" = "availableQuantity" - $1, "updatedAt" = now() WHERE
id = $2 AND "availableQuantity" >= $1 RETURNING id` — but this codebase's TypeORM/driver version
returns a different shape for `UPDATE ... RETURNING` than for `INSERT ... RETURNING`: an `INSERT`
returns a bare array of the returned rows (as used in §16's `findOrCreateStockBatch`), but an
`UPDATE` (and, by the same driver mechanics, `DELETE`) returns a `[rows, rowCount]` **tuple**. The
first implementation checked `updated.length === 0` to detect the guarded `WHERE` clause rejecting
the row (meaning some other transaction changed `availableQuantity` between the locked read and this
write) — but `updated` was always the two-element tuple, so `.length` was always `2` and the check
was permanently dead code; a race that should have thrown `Invariant violation: stock balance ...
changed under lock` would instead have silently proceeded as if the decrement succeeded. Fixed by
checking `updated[1] === 0` (the row-count element) instead. **Any future module issuing a raw
`UPDATE`/`DELETE ... RETURNING` through `manager.query()` must check the tuple's row-count element,
not the array's own `.length`** — only `INSERT ... RETURNING` returns a bare row array in this
codebase's driver. The same fix round also added a final `if (remaining > 0) throw new Error(...)`
after the batch-walk loop, an invariant check that should be unreachable (the pre-loop
`totalAvailable < quantity` check already guarantees the locked rows cover the requested quantity)
and guards against a future refactor silently breaking that guarantee — but on final whole-branch
review this was determined to be real protection against a walk that clearly falls short, **not a
guarantee against sub-representable floating-point residue.** A `quantity` that splits unevenly
across batches under IEEE-754 arithmetic — e.g. `0.3` fulfilled as `0.1` from one batch plus `0.2`
from another — can land `remaining` at exactly `0` due to rounding, so the invariant check does not
fire, `fulfilledQuantity` gets credited a clean `0.3`, and the actual sum of the `stock_balances`
decrements and `stock_transactions` ledger rows written is a value like `0.29999999999999998` —
silently leaving a residual fraction unaccounted for. Closing that gap would require decimal-safe
arithmetic instead of JavaScript's `Number()`, which is out of scope for now. Severity is low for
realistic hospital quantities (integers or at most 2 decimal places in practice), but this is not a
fully fail-safe invariant — don't describe it as one.

**Guarded direct-`UPDATE` decrement, not an upsert:** unlike Item A's `recordGoodsReceipt`, which
uses `INSERT ... ON CONFLICT ... DO UPDATE` because a goods receipt's `stock_balances` row may or may
not already exist for a given item/batch pairing, `fulfillRequisitionItem`'s decrement only ever
targets rows the FEFO query builder just selected and locked — by construction, those rows are
guaranteed to already exist, so a plain guarded `UPDATE ... WHERE "availableQuantity" >= $1` is
sufficient and an upsert would be solving a problem that can't occur here. The `WHERE` guard is the
load-bearing part: it's what turns an impossible-in-theory race (the row is locked under
`pessimistic_write` for the whole transaction) into a defense-in-depth check rather than a silent
overdraw if that locking assumption is ever violated by a future change.

**Numeric coercion and actor guards reused verbatim from Item A's fix round:** `createRequisition`
and `fulfillRequisitionItem` both `Number()`-coerce and `Number.isFinite`/positivity-check their
quantity fields, and both throw `BadRequestException` on a missing/blank `requestedBy`/`fulfilledBy`
actor string — the same pattern §16 established for `recordGoodsReceipt`'s numeric fields, applied
here from the start rather than needing its own fix-round discovery.

**`stock_transactions` is an append-only, polymorphic ledger — no FK, no sign convention:** the
table now has two writers, Item A's `recordGoodsReceipt` (`transactionType: 'GoodsReceipt'`,
`referenceId` pointing to a `purchase_order_items.id`) and this pipeline's
`fulfillRequisitionItem` (`transactionType: 'Dispatch'`, `referenceId` pointing to a
`stock_requisition_items.id`). Two conventions are load-bearing but not enforced anywhere in the
schema, so any future consumer of this table must account for them explicitly: **`quantity` is
always a positive magnitude regardless of `transactionType`** — direction is inferred from
`transactionType` (`'GoodsReceipt'` = stock in, `'Dispatch'` = stock out), never from the sign of
`quantity` — and **`referenceId` is polymorphic**, targeting `purchase_order_items.id` for
`GoodsReceipt` rows and `stock_requisition_items.id` for `Dispatch` rows, with no database-level FK
enforcing either target (consistent with this repo's no-FK convention) and no column other than
`transactionType` itself distinguishing which table a given row's `referenceId` points into.
Nothing today sums this ledger — `stock_balances` is the authoritative running total, and
`stock_transactions` is currently write-only/audit-trail — but Pharmacy and a future
Reporting/stock-ledger item are both queued to consume it, and a naive `SUM(quantity)` across both
transaction types would double-count stock movement instead of netting it. A future stock-ledger
report or audit view must branch on `transactionType` for both the sign and the join target rather
than assuming a uniform shape.

**With Item A and Item B both shipped, the Inventory module is complete** for the scope this pipeline
was designed to cover — catalog, procurement (stock IN), and requisition/dispatch (stock OUT) all
exist and are wired together through the shared `stock_balances`/`stock_batches` tables. Pharmacy,
the next Phase 6 item, can now build against a working stock pipeline instead of stubbing one.

See `new/docs/superpowers/plans/2026-08-06-inventory-requisition-dispatch.md` for the full
implementation history.

## 18. Pharmacy Dispensing Pipeline

Pharmacy is the module Inventory's Item A/B pipeline (§16, §17) was built to unblock: it consumes
`stock_balances`/`stock_batches` as-is, adding no new stock-holding tables of its own. The whole
module lives in `apps/api/src/pharmacy/`: one entity (`PharmacyDispensing`), one service
(`PharmacyDispensingService`), one controller (`PharmacyDispensingController`, gated by
`pharmacy.dispensing.create`, `pharmacy.dispensing.dispense`, and `pharmacy.read`), and one atomic
number generator (`PharmacyDispensingNumberGeneratorService`) — mirroring the per-module
number-generator shape every prior module (Lab, Radiology, Inventory) has its own copy of; there is
still no shared `@hospital/number-generator` library, by the same mirror-don't-extract convention
this section names below. Tables (`pharmacy_dispensings`, `pharmacy_dispensing_sequences`) and
permissions were both added in migration `0024-create-pharmacy-tables`.

**Order-routed reclassification, mirroring Lab/Radiology's `createRequisition` shape — with the
duplicate-race prevention baked in from day one, not retrofitted:** `createDispensing` takes an
`orderItemId` and an `inventoryItemId`, loads the `OrderItem`, and rejects it unless
`itemType === 'Pharmacy'` and `status !== 'Cancelled'` — the same "reclassify a generic `OrderItem`
against a domain-specific catalog reference" shape Lab and Radiology's requisition-creation methods
established first. This is the third time this codebase has needed that pattern (after Lab and
Radiology), and each time it's a fresh implementation in the new module rather than a shared
"order-routed intake" helper — consistent with this codebase's established convention of mirroring a
proven shape rather than extracting it. Unlike Lab's first cut, which needed a fix-round to add duplicate-prevention after the fact,
Pharmacy (like Radiology) reuses that hardened pattern and ships the `UQ_pharmacy_dispensings_active_order_item`
partial unique index (`ON pharmacy_dispensings ("orderItemId") WHERE status <> 'Cancelled'`)
in the same initial migration as the table itself, paired with an in-transaction
`findOne({ where: { orderItemId, status: Not('Cancelled') } })` pre-check for a fast, friendly
`ConflictException` plus a `QueryFailedError`/`constraint` catch scoped to that exact constraint
name as the race-safe backstop — both halves of the pattern present from the start, because the
Lab/Radiology/Inventory fix-round history had already established that a pre-check alone is
insufficient under concurrent requests.

**Item B's FEFO batch-walk, reimplemented as Pharmacy's own copy, not a shared call — and why:**
`dispenseDrug` walks `StockBalance` rows for `dispensing.inventoryItemId`, nearest-expiry-first via
an inner join to `StockBatch`, using the identical `createQueryBuilder` shape §17 documented for
`InventoryRequisitionService.fulfillRequisitionItem` — same `ORDER BY batch.expiryDate ASC NULLS
LAST, batch.createdAt ASC, balance.id ASC` tie-break, same `.setLock('pessimistic_write', undefined,
['balance'])` scoped-lock, same guarded raw `UPDATE ... RETURNING id` with the `updated[1] === 0`
tuple-row-count check §17's fix round established, same post-loop `if (remaining > 0) throw` residue
guard. This is the second time this codebase has needed FEFO stock-decrement mechanics (after Item
B), and it is a second from-scratch copy, not a call into `InventoryRequisitionService`. Two reasons,
both structural rather than stylistic: **different actor model** — Item B's fulfillment is keyed to
a `stock_requisition_items` line and a `fulfilledBy` staff actor recorded per fulfillment call,
while Pharmacy's dispense is keyed to a `pharmacy_dispensings` record and a `dispensedBy` pharmacist
recorded once per dispensing — and **different ledger `referenceId` target** — Item B's
`stock_transactions` rows point `referenceId` at a `stock_requisition_items.id`, Pharmacy's point it
at a `pharmacy_dispensings.id`, so the write half of the method is domain-specific even though the
read/lock/decrement half is identical. Extracting a shared FEFO-walk helper would need to
parameterize both the actor field and the `referenceId` target, and this codebase has consistently
chosen not to build that kind of parameterized shared abstraction after only two occurrences —
mirror-don't-extract holds here the same way it holds for the number-generator services.

**`'PharmacyDispense'` — the third `stock_transactions.transactionType` value:** extending the
polymorphic-`referenceId`-by-`transactionType` convention §17 documented (`'GoodsReceipt'` →
`purchase_order_items.id`, `'Dispatch'` → `stock_requisition_items.id`), `dispenseDrug` writes
`transactionType: 'PharmacyDispense'` with `referenceId` pointing at the `pharmacy_dispensings.id`.
`quantity` is still always a positive magnitude — `'PharmacyDispense'`, like `'Dispatch'`, means
stock out, inferred from `transactionType` alone, never from a sign on `quantity`. No column in
`stock_transactions` enforces which table a given `transactionType` points `referenceId` into; any
future consumer (a stock-ledger report, an audit view) must branch on all three values now, not two.

**A two-step flow, not three — deliberately narrower than Lab/Radiology's shape:** `createDispensing`
sets status `Pending`; `dispenseDrug` (gated by `pharmacy.dispensing.dispense`, requiring a non-blank
`dispensedBy`) walks stock and advances status straight to `Dispensed`, recording `dispensedBy` and
`dispensedAt` on the same call. There is no separate verification step — unlike Lab and Radiology's
three-step `create → enter result/scan → verify` shape, where a second actor signs off before a
result is final, pharmacy dispensing has only the two steps a real pharmacy counter workflow needs:
prepare/queue the order, then hand the drug over. `cancel` is only reachable from `Pending` (the same
cancel-only-from-the-pre-commit-state rule Item A's PO and Item B's requisition both follow), so a
`Dispensed` record is terminal with no reversal path — a return/write-off flow, if ever needed, is
explicitly out of scope here (see below).

**Explicit scope cuts:** Pharmacy has **no separate drug catalog** — a drug is just an
`InventoryItem` (the same catalog Inventory Item A built), with no generic-name, dosage-form,
strength, or controlled-substance fields layered on top. The design's framing of a drug as "an
`InventoryItem` whose sub-category has `isConsumable = true`" is descriptive catalog metadata
only — `createDispensing` never checks that flag, so any catalog item (a wheelchair, a lab
reagent, anything in the catalog) can technically be dispensed as a "drug" today; enforcing that
boundary, if ever needed, would be a future validation addition, not a retrofit to this branch.
There is **no walk-in/OTC sales path** —
every dispensing requires an existing `OrderItem`, so a patient walking up to the pharmacy counter
without a doctor's order has no code path here. **Billing stays fully decoupled** — `dispenseDrug`
never touches a billing/charge table; whatever charges a dispensed drug generates is entirely
Billing's concern, not Pharmacy's, matching how Lab and Radiology also don't self-bill.

**This is the first module in the pending-tasks pipeline to ship with zero task-review findings
across all its code tasks.** Every prior module in this pipeline (Lab, Radiology, Inventory Item A,
Inventory Item B) needed at least one fix-round commit after its initial task implementation —
duplicate-prevention retrofits, the `RETURNING` tuple-shape bug, missing request-body validation,
numeric-coercion gaps. Pharmacy's six `feat(pharmacy):`/`feat(rbac):` commits (see
`new/docs/superpowers/plans/2026-08-06-pharmacy-dispensing.md` for the full implementation history)
contain no corresponding fix commits. The most plausible reason: Pharmacy's two structurally hardest
problems — order-routed reclassification with race-safe duplicate prevention, and locked FEFO
stock decrement — were both *reuses* of patterns this pipeline had already hardened in Lab/Radiology
and Item B respectively, not new logic written from scratch. Any future module that can position
itself as a third or fourth consumer of an already-hardened pattern, rather than inventing its own,
should expect the same payoff.

## 19. Shared Pagination and Required-Filter Enforcement

Any new list endpoint that returns more than a handful of rows should use `@hospital/pagination`'s
`paginate()`/`paginateRaw()` — both clamp `page`/`limit` internally (`page` floors at 1; `limit`
floors at 1, ceilings at 100) regardless of what the caller sends, including non-numeric or
missing values. This clamping is manual code, not `class-validator`/`ValidationPipe` — this
codebase has no `ValidationPipe` registered anywhere (confirmed: `apps/api/src/main.ts` and
`app.module.ts` register none), and no other DTO in the codebase uses `class-validator` either, so
a decorator-based approach would be silently inert. `PaginatedResponseDto<T>`'s shape is
`{ data: T[], meta: { total, page, limit, totalPages } }` — note `total`/`page`/`limit` live under
`meta`, not at the response root.

For a list endpoint whose filter parameter scopes access to one parent entity's children (e.g.
"purchase orders for this vendor," "requisitions for this department") rather than narrowing an
otherwise-legitimate whole-tenant browse view, use `@hospital/pagination`'s `requireParam(value,
paramName)` at the top of the service method to reject the request with `BadRequestException` when
the filter is omitted, instead of letting TypeORM's `find({ where: { x: undefined } })` silently
drop the WHERE clause and return everything. Genuinely optional browse/search filters (e.g.
`PatientsService.findAll`'s `q`/`phoneNumber`/`patientNo`, or a whole-tenant stock-level view like
`listStockBalances`'s `itemId`) should stay optional — `requireParam()` is for "list one parent's
children," not every filterable field.

## 20. Billing Return/Credit-Note

`InvoicesService.createReturn` (`POST /billing/invoices/:id/returns`) models a return as an
invoice-level balance adjustment, not a separate document: it reduces both `Invoice.totalAmount`
and `paidAmount` by the return amount and recomputes `status` with the exact same rule
`recordPayment` uses (`paidAmount >= totalAmount ? 'Paid' : 'PartiallyPaid'`). A full return of a
fully-paid invoice lands at `totalAmount: 0, paidAmount: 0, status: 'Paid'` — consistent with
`create()`'s existing "a zero-value invoice is immediately Paid" convention, not a special case.

Only allowed against a `Paid`/`PartiallyPaid` invoice (`paidAmount > 0`); an invoice with no
recorded payments must use the existing `cancel` endpoint instead — `createReturn` rejects it with
a message naming `cancel` as the correct action. Return amount is capped at `paidAmount`, never
`totalAmount` — a return can't refund more cash than was actually collected.

**Money-mutation methods must take a `pessimistic_write` lock on their initial invoice lookup.**
`createReturn` does (`repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } })`),
matching this codebase's established status-transition-mutator pattern (§15/§16). This was not the
starting shape — a risk-gated security review (per `CLAUDE.md`'s MVP Fast Track, since Billing is
money-touching) caught the lock's absence, plus a `NaN`-slips-through gap in the amount validation
(a bare `amount <= 0` check is silently `false` for `undefined`/`NaN`; fixed with
`Number.isFinite()` first), before the feature was committed. The same missing-lock gap was found
to already exist, unfixed, in `recordPayment`/`cancel` — tracked as a separate follow-up in
`pending-tasks.md`, not retrofitted as part of this item.

`returnedBy` is client-supplied, same as every other actor field in this codebase
(`review-comments.md`'s codebase-wide "actor fields are client-supplied" gap) — not fixed here,
tracked there.

## 21. Frontend Theming and Screen Layout

**Superseded 2026-08-12:** the navy theme below (established 2026-08-09) was replaced, in the same
uncommitted session that built the Tenants/Users/Master Data/Global Catalog/Audit/Patients/Billing
Settings screens, with a glassmorphism ("Ocean Breeze" teal/blue) look. That session was never
committed or documented at the time; this section was rewritten after the fact, once the human
partner confirmed keeping the new direction, to describe what's actually in the codebase rather
than the superseded navy pattern. No new design spec doc exists for this pass — treat this section
as the source of truth going forward.

`staff-console`'s visual language:

- **Theme:** a `definePreset(Aura, {...})` sky/blue "Ocean Breeze" ramp in `app.config.ts`
  (`OceanBreezePreset`), not the bare `Aura` preset — `primary.600` (`#0284c7`) is the button/brand
  color, used via `colorScheme.light.primary.color`. The `surface` scale stays PrimeNG's default.
  Any new brand color needs the same `definePreset` treatment, not ad-hoc hex values in templates.
- **Shell:** `AppShellComponent` is a frosted-glass sidebar (`bg-white/60 backdrop-blur-xl`) over a
  soft mesh-gradient page background (`body`'s `background-image` in `styles.css`), not a solid
  navy sidebar. Nav links are pill-shaped (`rounded-full`) and use the `gradient-bg`
  utility class (below) for the active/hover state, gated per-link by
  `AuthService.hasPermission(...)` — a link only renders when the current user actually holds the
  permission the screen's route guard requires (see `app.routes.ts`), and a permission string used
  for gating must be one the backend's `seed-rbac-catalog.ts` actually seeds — a made-up permission
  name silently disables a nav link for everyone. New nav entries get added only when the screen
  they point to actually ships — no placeholder links for unbuilt screens.
- **Glass utility classes** (`styles.css`, `@layer tailwind-utilities`): `.glass-panel` (page-level
  content containers — tables, main cards), `.glass-card` (smaller nested cards), `.glass-input`
  (text inputs sitting directly on the gradient background, e.g. the patient search box),
  `.glass-modal` (applied via a PrimeNG component's `styleClass` to `p-dialog` panels). All four
  must stay defined in `styles.css` — a class referenced in a template but not defined there is
  silently unstyled (this happened to `.glass-input`/`.glass-modal` across ~10 templates in the
  session that introduced them; caught only by grepping every glass-prefixed class name against
  `styles.css`'s actual definitions, not by typecheck/lint/tests, since an unknown CSS class isn't
  a compile error). `.gradient-text`/`.gradient-bg` (brand-gradient text and pill-button
  backgrounds) round out the utility set.
- **Screen styling:** Tailwind utility classes backed by the `tailwindcss-primeui` plugin
  (`bg-primary-*`, `text-surface-*`, etc. — see `node_modules/tailwindcss-primeui/v4/theme/colors.css`
  for the full list) plus the glass utilities above, not raw hex values or a separate CSS file per
  component. Page headers use `text-3xl font-bold tracking-tight text-slate-900` (or `text-slate-800`
  inside a glass panel) + a `text-sm text-slate-500` subtitle line — reuse these exact classes for
  consistency rather than inventing new spacing/sizing per screen. The pre-existing Billing screens
  (invoice list/detail, login) were restyled to match in the same session; new screens should match
  their look, not the superseded navy one.
- **PrimeIcons:** global CSS (`<i class="pi pi-{name}">`), no Angular module import needed — only
  import a PrimeNG *component* module (`ButtonModule`, `TagModule`, etc.) when using that
  component, not for icons alone.

## 22. Platform vs. tenant altitude

The system has two audiences, and every new screen and endpoint belongs to exactly one.

- **Platform (vendor/ops).** Accounts live in the reserved `__platform` tenant
  (`apps/api/src/tenants/platform-tenant.ts`), never inside a customer hospital. `__platform` is
  excluded from tenant listings and direct fetches, is not provisionable through the API, and
  cannot be suspended. Seeded by `seedPlatformAdmin()`.
- **Tenant (hospital staff).** Accounts live in their hospital's own schema. Seeded for the demo
  hospital by `seedDemoHospitalAdmin()`.

**Platform users have no access to tenant data, and this is structural rather than guarded.**
Tenant scope derives from the JWT's `hospitalId` claim
(`libs/tenant-context/src/lib/tenant-context.middleware.ts`), so a platform user's queries resolve
against the empty `__platform` schema. Do **not** add per-endpoint "is this a platform user" checks
— they are redundant, and adding them implies the boundary depends on remembering them.

**Frontend.** Two shells over two route trees, both wrapping `ShellChrome`:

| | Platform | Tenant |
|---|---|---|
| Shell | `PlatformShell` | `AppShell` |
| Guard | `platformGuard` | `tenantGuard` |
| URLs | `/platform/*` | `/clinical/*`, `/billing/*`, `/admin/*` |
| Landing | `/platform/dashboard` | `/billing/invoices` |
| Dev URL | `http://admin.localhost:4200` | `http://<hospitalId>.localhost:4200` (e.g. `demo.`) |

Audience is decided by `AuthService.isPlatformAdmin`, derived from the JWT's `hospitalId` claim —
never from a role name, which is renameable and not authoritative. A new screen picks a tree; it
does not add an `@if` to a shared sidebar. Screens meaningful at both altitudes (`UserList`,
`AuditList`) are routed into both trees pointing at the same component, unparameterized, because
they already scope themselves by the JWT's tenant.

## 23. Architecture review fixes (2026-08-14): module-boundary coverage, dead billing coupling, migration ordering, and two dedup extractions

A senior-architect-level review of `apps/api` surfaced four issues, all fixed in the same pass.

**Module-boundary lint had a blind spot covering exactly the modules that most needed it.**
`eslint.config.mjs`'s `boundaries/elements` tagged 11 domains but never tagged `lab`, `radiology`,
`pharmacy`, or `inventory` — the four newest, most cross-coupled domains (§14–§18) sat completely
outside `eslint-plugin-boundaries`' coverage; nothing there could ever fail lint for a domain-to-domain
violation. Fixed: all four are now tagged, with a `pharmacy → inventory` edge sanctioned in the
allow-list (Pharmacy legitimately consumes Inventory's `stock_balances`/`stock_batches`, per §18) and
`lab`/`radiology`/`pharmacy` each sanctioned to depend on `orders` (all three read `OrderItem` to
validate/reclassify it in `createRequisition`/`createDispensing`). **This edit is manual, not agent-applied**
— `eslint.config.mjs` is a protected config file per this repo's `guard-config.sh` hook, which has no
programmatic bypass condition (its own "use explicit instruction" error text is aspirational, not
implemented); the human partner applied the diff by hand.

**Lab/Radiology/Pharmacy were bypassing `OrdersService` and calling Billing directly — both violations
the new tagging would have caught.** Each workflow service's `verify()`/`dispenseDrug()` reached into
`manager.getRepository(OrderItem)` directly to mark the order item Completed (violating §1's "inject the
corresponding Service" rule), then called `InvoicesService.autoChargeForCompletedOrder()` directly — a
`lab/radiology/pharmacy → billing` dependency in the wrong direction, never sanctioned, and one the
codebase's own abandoned `OrderBillingAdapter` interface (`billing/adapters/`, added in `c416f0a` and
never wired up) had already correctly identified as the wrong shape. Fixed two ways:

- `OrdersService.completeItemInTransaction(manager, itemId, input)` — a new method taking a
  caller-supplied `manager` so Lab/Radiology/Pharmacy can complete an order item in the *same*
  transaction as their own status transition, through the service, without reaching into the
  repository. The existing public `completeItem()` (the direct `/orders/:id/items/:itemId/complete`
  endpoint) is unchanged — different caller, different semantics (strict Pending-only vs. this
  method's idempotent already-Completed-is-a-no-op behavior, matching what each workflow service was
  already tolerant of inline).
- **`autoChargeForCompletedOrder()` was deleted, not rewired.** Investigation found it (and the dead
  `OrderBillingAdapter` implementations) queried tables that don't exist —
  `lab_catalog_tests`/`radiology_catalog_items`/`inventory_catalog_items` — the real tables are
  `lab_tests`/`radiology_imaging_items`/`inventory_items`, none of which carry a price column at all.
  This means auto-charge has almost certainly never produced a real invoice in this codebase's
  history; every call was silently swallowed by its own `catch (billingError) { console.error(...) }`
  block. Rather than half-fix a feature with no underlying pricing data model (a product/schema
  decision, not an architecture fix), the dead code was removed outright and Lab/Radiology/Pharmacy
  no longer depend on Billing at all. `pending-tasks.md`'s "Billing: automatic charge-capture" item
  remains open and accurate — it was never actually done, despite code that looked like it existed.

**Migration ordering was broken.** `database/migrations/0008-create-patient-tables.ts`'s `name` field
(`CreatePatientTables0008200000000008`) had a malformed timestamp suffix: TypeORM's migration runner
sorts by `name.slice(-13)` parsed as an integer (`MigrationExecutor.js`), and that migration's suffix
parsed to `8200000000008` — sorting it **dead last** among all 28 migrations instead of 8th, after
every migration with an FK on `patients` (Appointments, Vitals, Orders, Billing, ...). Fixed by
correcting the `name` to `CreatePatientTables0008_2000000000005`, sorting it correctly between
`CreateMasterDataTables` (`...004`) and `CreateAppointmentsTable` (`...006`). This was silently
breaking tenant provisioning generally, not just test setup — confirmed by re-running the previously-failing
suite (which had misleadingly looked like a Postgres/Docker environment issue) clean afterward.

**Two extractions, both zero-call-site-change wrapper patterns, not signature changes:**

- `database/sequence-number-generator.service.ts` (`SequenceNumberGeneratorService.generateNext(table,
  prefix)`) replaces the identical SQL/padding/formatting logic duplicated across all 6 number
  generators (Patients, Lab, Radiology, Pharmacy, Inventory's purchase-order and stock-requisition
  sequences — six, not the four §18 named, since Patients and Inventory's second generator were missed
  in that count). Each domain's generator class (`LabRequisitionNumberGeneratorService`, etc.) is now a
  thin wrapper naming its own sequence table and default prefix; it still takes `TenantConnectionService`
  in its constructor and constructs its own `SequenceNumberGeneratorService` internally, so **no DI
  wiring or call site anywhere changed** — same class names, same public methods, same constructor
  signatures.
- `inventory/fefo-stock-decrement.service.ts` (`FefoStockDecrementService.decrementInTransaction(manager,
  input)`) replaces the FEFO locked-batch-walk previously duplicated line-for-line between
  `InventoryRequisitionService.fulfillRequisitionItem` and `PharmacyDispensingService.dispenseDrug`
  (§17/§18) — same locking, same `UPDATE ... RETURNING` tuple-shape handling, now in one place. Unlike
  the number-generator wrappers, this one **does** change both callers' constructors (a new
  `FefoStockDecrementService` parameter) since it needs the caller's own `manager` to stay in the same
  transaction — every manual-construction call site in integration specs was updated accordingly.
  `pharmacy.module.ts` needed no change: it already imports `InventoryModule`, which now exports
  `FefoStockDecrementService` alongside its other providers.

New test coverage added as part of this pass: `radiology-workflow.service.integration-spec.ts` (7
tests) and `pharmacy-dispensing.service.integration-spec.ts` (12 tests, including FEFO
nearest-expiry-first ordering across split batches and null-expiry-consumed-last) — both modules
previously had zero test files despite carrying the same correctness-critical locking logic Lab and
Inventory needed fix-rounds for.

**New gaps found, not yet their own items:** `encounters.controller.integration-spec.ts` hangs
indefinitely when run in isolation (not a resource-contention artifact of running the full suite in
parallel — confirmed by clearing all Postgres sessions and re-running alone) — unrelated to this
pass's changes (Clinical/Encounters, not touched), not investigated further, worth a focused look.
`InvoicesService.autoChargeForCompletedOrder` also reached into `Order`/`OrderItem` via raw repository
access rather than `OrdersService` before its removal — moot now that the method is gone, but the same
"Billing reaches into Orders directly" pattern still exists in the surviving `list()`/other methods
and should be kept in mind if Billing ever needs Orders data again.

## 24. Test-infrastructure hardening (2026-08-20): integration-suite timeouts, throttler isolation, paginated-spec shape, and the search_path/RBAC gotchas

Full-AppModule integration suites are the heaviest things in this repo — each one compiles the whole
Nest DI graph, provisions tenant schema(s)/roles, and often seeds the RBAC catalog. Three
environment-level fixes landed together because a full-suite parallel run kept tripping them:

- **`apps/api/jest.config.cts` sets `testTimeout: 60000`.** Jest's default 5000ms per test/hook is
  too tight once suites run in parallel workers (or a dev machine is otherwise under load, e.g. the
  API dev server building). The heaviest single test — `tenant-test-context`'s "self-heals" test,
  which provisions a tenant schema twice (two full migration runs) — needs the headroom. Keep the
  ceiling sane: a genuinely hanging test (the historical ThrottlerGuard/Redis port hang) still times
  out at 60s; don't paper over real hangs by raising it further.
- **ThrottlerGuard uses in-memory storage under `NODE_ENV=test`** (`app.module.ts`). With the
  Redis-backed storage, every parallel test app instance shared ONE counter on the dev Redis, so a
  full-suite run could aggregate past the guest (20/60s) / authenticated (100/60s) limits and 429
  unrelated suites — intermittent, timing-dependent failures with no code-level cause. In-memory
  storage is per-app-instance, so each suite's counters are its own and the real guard path still
  runs. (This also makes the old "test bypass" dead code — `GLOBAL_RATE_LIMIT` — removable.)
- **Service-spec `list()` assertions must use the `{ data, meta }` shape.** Every service whose
  `list()` returns `PaginatedResponseDto` (`data` + `meta.total`/`meta.page`/`meta.limit`) is
  asserted that way (see §19). Four stale call sites in the billing and appointments service specs
  still used positional args and flat fields (`filtered.total`) from the pre-pagination era and were
  aligned in this pass — when a service is migrated to `paginate()`, update its spec's call AND its
  shape assertions together.

Two environment gotchas discovered along the way, both worth remembering:

- **`runInTenantSchema` sets `search_path` to `("tenant_<id>", public)`.** A query that fails in the
  tenant schema can fall through to a stale `public.*` table from the pre-tenant-schema era instead
  of erroring with 42P01 — the reporting publisher's SQL-failure test hit exactly this (42P01
  expected, 42501 `permission denied` received, because the tenant role has no grants on public
  tables). When asserting on a Postgres error, accept every legitimate failure mode the schema
  layout can produce, and check for `public.*` leftovers when an error text changes between
  environments.
- **The global RBAC catalog tables (`roles`, `permissions`, `role_permissions`) live in `public`,
  not per tenant.** `seedRbacCatalog` is insert-only (`orIgnore()`), so **removing a mapping from
  `seed-rbac-catalog.ts` never propagates to an existing dev DB**. Corollary found 2026-08-20:
  `seed-initial-setup.ts` grants Super Admin **all** permissions (a blanket loop), so the catalog
  must map Super Admin to the same permissions or the two seeds disagree — the patients.* mappings
  were missing from the catalog (every other module had them) and were added; the
  `seed-rbac-catalog.integration-spec.ts` patients expectations were aligned accordingly. If
  catalog reconciliation (prune mappings absent from the seed) is ever wanted, it needs an explicit
  migration or a seed-mode flag — do not make the seed delete rows by default, since production may
  carry hand-added grants.

## 25. Actor fields derive from the authenticated principal, never the request body (2026-08-20)

Every domain "actor" field — `enteredBy`, `verifiedBy`, `sampleCollectedBy`, `scannedBy`,
`reportEnteredBy`, `createdBy`, `receivedBy`, `returnedBy`, `refundedBy`, `dispensedBy`,
`fulfilledBy`, `recordedBy`, `requestedBy`, `orderedBy`, `completedBy`, `transferredBy`,
`dischargedBy`, `preparedBy`, `reviewedBy`, `triagedBy`, tenant-provisioning `createdBy` — is a
**record of who performed the action**, so it must come from the authenticated principal, not from
the caller. The pattern, applied uniformly across all 10 modules:

- The service injects `TenantContextService` (last constructor param) and keeps one private helper:

  ```ts
  /** Actor fields are never trusted from the caller: the authenticated principal
   * (TenantContextService.accountId, set by TenantContextMiddleware from the verified JWT) wins;
   * the passed value is only a fallback for non-HTTP callers (service specs). */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }
  ```

- Every actor assignment goes through `resolveActor(...)`. If the resolved actor is also forwarded
  to another service (e.g. `OrdersService.completeItemInTransaction({ completedBy })`), forward the
  **resolved** value, not the raw input.
- Actor method parameters and input-interface fields are optional (`actorField?: string`); the DTO
  fields are optional-but-ignored (deprecation comment), so existing clients keep working and new
  ones can simply omit them. The entity column stays NOT NULL (with DB CHECK constraints where they
  already exist), so a non-HTTP caller with neither a context nor a fallback fails at write time —
  which is correct: the actor is mandatory, just not client-suppliable.
- **Exception:** triage's `broughtBy` (who accompanied the patient — a companion/relative, not the
  logged-in user) is a legitimately client-supplied field; never touch it.
- Test pattern (see any module's `*.service.integration-spec.ts`, e.g. lab): run the call inside
  `ctx.tenantContext.run({ tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId }, () => ...)`
  while passing a spoofed actor uuid, and assert the persisted entity records
  `AUTHENTICATED_ACCOUNT`. `ctx.inTenant()` sets no accountId, so pre-existing specs that pass
  `STAFF_ID`-style constants keep working on the fallback path.

Where the auth context is absent (`OrdersService`'s optional `tenantContext` — kept optional so
other modules' specs that construct it manually still typecheck), the `?.` fallback keeps the
documented behavior.

**Defect found by this pass:** the `DischargeSummary` entity had routes and a service but was never
registered in `data-source.ts`'s entities list and no migration created `discharge_summaries` —
every endpoint threw `EntityMetadataNotFoundError`. Lesson: "routes mapped" is not "feature works";
a new entity needs (a) registration in `data-source.ts`, (b) a tenant migration, (c) an integration
test that actually writes to the table. This pass added all three (migration `0030`).

## 26. Standalone CLI runners (migrate/seed) must exit explicitly (2026-08-20)

Every standalone script that uses `data-source.ts` — `migrate.ts`, `migrate-tenants.ts`,
`seed-rbac-catalog-runner.ts`, `seed-initial-setup-runner.ts` — ends with an explicit
`process.exit(0)` on success. This is load-bearing, not cosmetic:

- The nx targets run them through the swc-node ESM loader (`node --import
  @swc-node/register/esm-register`), which keeps two worker IPC pipes open for the process's
  lifetime.
- `data-source.ts` registers a pool-monitor `setInterval` (every 30s) whenever `NODE_ENV !==
  'test'`, which never clears.

Both keep the event loop alive after the script's work finishes, so without the explicit exit the
command appears to hang forever despite having applied every migration. Under Jest (`NODE_ENV=test`)
the interval is skipped and the loader pipes don't block Jest's own teardown, which is why the
migration logic always "worked in tests" while the CLI hung.

Two follow-on gotchas surfaced once the runners actually ran:

- **Renaming a migration breaks already-provisioned schemas.** TypeORM matches pending migrations by
  the recorded `name`; when the 0008 patients migration was renamed (`3741e67`, 2026-08-14), every
  pre-existing tenant schema still recorded the old name, so `migrate-tenants` tried to re-apply it
  (`relation "patients" already exists`). Fix for existing dev schemas: `UPDATE <schema>.migrations
  SET name = '<current name>' WHERE name = '<old name>'`. New schemas are unaffected.
- **`seed-initial-setup.ts` grants Super Admin ALL permissions** (blanket loop), so the
  `seed-rbac-catalog.ts` catalog must map Super Admin to the same set or the two seeds disagree and
  the catalog's own integration spec fails on any DB that ran the initial setup (see §24).

## 27. Catalog pricing and automatic charge-capture (2026-08-20)

The registration→visit→bill flow's missing link — nothing charged the patient when clinical work
completed — is now closed with a pricing data model and an in-process capture path.

**Pricing model:** `lab_tests.price`, `radiology_imaging_items.price`, `inventory_items.salePrice`
(single currency ₹, `numeric(10,2)` nullable = not priced; migration `0031`). Catalog create
accepts the price; new `PATCH <catalog>/.../price` endpoints set/update it (guarded by the module's
`*.catalog.manage` permission). Each entity carries a locally-mirrored `numericTransformer`
(mirror-don't-extract: importing billing's transformer would create a lab/radiology/inventory →
billing edge; the transformer converts node-postgres's string numerics to numbers).

**Capture:** `billing/charge-capture.subscriber.ts` is a TypeORM subscriber wired like the
audit/reporting/notification subscribers (pushed onto the DataSource from `OnModuleInit`). It
filters on `event.metadata.tableName === 'order_items'` (no `listenTo` — binding by entity class
would import the OrderItem entity and create a billing → orders module edge) and fires when the row
transitions to `Completed`, which is the single choke point every clinical completion flows through
(`OrdersService.completeItemInTransaction`, called by Lab verify, Radiology verify, Pharmacy
dispense). `InvoicesService.captureChargeForOrderItem(manager, orderItem)` then:

1. idempotency-checks `sourceOrderItemId` (never charge twice);
2. resolves the price per itemType (lab test / imaging item / inventory salePrice) via raw
   `manager.query` joins on the tenant schema (no cross-module entity imports);
3. appends a line to the patient's open (`Unpaid`/`PartiallyPaid`) invoice, creating one if none
   exists (`createdBy` = authenticated principal, falling back to the order item's `completedBy` so
   the NOT NULL column can never abort the transaction).

**Failure semantics (human ruling: best-effort):** every "skip" decision (unpriced, unsupported
item type, already charged) is made before any SQL write, so those paths can never roll back the
completing workflow. A genuine SQL failure during capture is logged and never rethrown, but — like
the reporting constraint documents — a Postgres error inside the business transaction still aborts
it, surfacing the failure loudly rather than silently losing revenue. Known follow-ups: no re-run
endpoint for a failed capture, and the open-invoice find-or-create is not row-locked (a concurrent
first-capture race could create two invoices).

## 28. Catalog update/soft-delete (2026-08-20)

The Lab, Radiology, and Inventory catalogs were create+list-only; the named gap is closed with the
master-data soft-delete pattern (`isActive`, migration `0032` added the column to all eight catalog
tables: `lab_tests`, `lab_test_categories`, `radiology_imaging_items`, `radiology_imaging_types`,
`inventory_items`, `inventory_item_categories`, `inventory_item_sub_categories`,
`inventory_vendors`):

- **Update** `PATCH <catalog>/.../:id` applies only the provided mutable fields (price/salePrice
  keep the existing non-negative `Number.isFinite` guard); deactivate/reactivate mirror
  `master-data.service.ts` exactly (second deactivate → `ConflictException '... is already
  deactivated'`; unknown id → `NotFoundException`).
- **Lists and `get` keep returning deactivated rows** — exactly like departments/wards/beds. The
  soft-delete's teeth are in the workflow guards: `createRequisition` (Lab + Radiology) and
  `createDispensing` (Pharmacy) reject an inactive test/imaging item/inventory item with a
  `ConflictException`, so deactivated entries can't be used for NEW work while every historical
  record keeps its reference intact. Existing requisitions are unaffected (they resolve the
  catalog row directly).
- This is the "delete" convention for the whole codebase: **never hard-delete a catalog row that
  existing records reference** — deactivate instead. A future item could surface a
  `?includeInactive=` flag if a screen needs to see or restore deactivated entries (today the
  reactivate endpoint covers restoration by id).

## 29. Fixed Asset module (2026-08-20)

PRD Phase 3's first net-new module: an asset register with read-time straight-line depreciation.
Follows every established convention — tenant-scoped `runInTenantSchema`, the shared
`SequenceNumberGeneratorService` wrapped in a domain number generator (`FixedAssetNumberGeneratorService`,
exactly like the lab/radiology/pharmacy wrappers — the shared service is never a DI provider),
§28's `isActive` soft-delete, `{ data, meta }` pagination, `resolveActor`-free (no actor fields
needed yet), and permissions added to `seed-rbac-catalog.ts` (`fixed-asset.read` /
`fixed-asset.manage` → Super Admin, Hospital Admin, Inventory/Store Manager).

**Depreciation is computed on read, never stored:** `computeStraightLineValuation` is a pure
function — annual = (cost − salvage) / usefulLifeYears, accumulated = annual × (full months in
service / 12) capped at cost − salvage, book value = cost − accumulated; `usefulLifeYears = null`
means no depreciation accrues. There is deliberately no accrual job or stored accumulated column:
a read always reflects the current date, which is the right MVP trade (a periodic accrual run would
need a scheduler and a posting target). The pure function is exported for direct unit testing with
an explicit `asOf` date.

**New-module wiring checklist (the fixed-assets module was the template):** domain folder with
entities/DTOs/service/controller/module (+ number-generator wrapper), entities registered in
`data-source.ts`, migration registered in `migrations/index.ts`'s `TENANT_MIGRATIONS`, module
imported in `app.module.ts`, permissions added to `seed-rbac-catalog.ts` (+ the seed's own
integration spec if the catalog assertions enumerate permissions), and a
`TenantTestContext`-based integration spec. Note the domain folder name must not collide with the
webpack `apps/api/src/assets` favicon folder — hence `fixed-assets`, not `assets`.

## 30. Insurance & Claims module (2026-08-20)

PRD Phase 3's second net-new module: payer master + patient policies + a claims lifecycle. All
established conventions apply (tenant-scoped services, `isActive` soft-delete for the payer/policy
masters, wrapped sequence generator for `CLM-…` claim numbers, `{ data, meta }` pagination,
permissions in `seed-rbac-catalog.ts` → Billing/Accounts Staff, Hospital Admin, Super Admin,
migration `0034`).

**Claims state machine** — `Draft → Submitted → Approved → Paid`, with `Submitted → Rejected`:
every transition is row-locked (`pessimistic_write`), conflicts throw `ConflictException` naming
the current vs. target status, and money fields are validated (`amountClaimed > 0`,
`amountApproved ≤ amountClaimed`). **Actor fields (`submittedBy`, `processedBy`) follow §25** — the
authenticated principal wins, and the service input keeps an optional deprecated field as the
non-HTTP fallback, so the NOT NULL columns can never abort a caller that omits them. Eligibility
(`checkCoverage`) is stateless: active policy AND the date inside the coverage window.

**Billing linkage note:** a claim references an invoice and validates the invoice belongs to the
policy's patient, but the claim tracks only the insurance reimbursement — patient-side settlement
stays in Billing's own payment records. Reconciliation between approved claims and payments is a
named future item (it would be the first real cross-module money flow beyond charge capture).

## 31. Accounting module (2026-08-20)

PRD Phase 3's third net-new module: chart of accounts + double-entry journal + read-only reports.
All conventions apply (tenant-scoped services, wrapped sequence generator for `JRN-…` numbers,
§25 actor derivation on `createdBy`/`postedBy`, `isActive` soft-delete for accounts, permissions →
Billing/Accounts Staff, Hospital Admin, Super Admin, migration `0035`).

**Double-entry invariants are enforced at creation and at posting:** every journal needs ≥ 2 lines,
each line has exactly one non-zero side (never both debit and credit, never a zero line), and total
debit must equal total credit — validated up front and re-checked on `postJournal`. Posted journals
are immutable (`ConflictException` on re-post); corrections are new entries (a reversing-journal
feature is a named future item).

**Reports are read-only computed queries over posted journals** — no stored balances, no accrual
job (same trade as Fixed Asset depreciation, §29):
- trial balance: per-account debit/credit totals + balance (debit − credit), filtered by period;
- income statement: Income rows reported as `-balance` (credit balances) and Expense rows as
  `+balance` (debit balances) — get the signs right or revenue comes out negative;
- balance sheet: Assets at `+balance`, Liabilities/Equity at `-balance`, **plus a retained-earnings
  row equal to net income accumulated through the as-of date** — without it the sheet cannot
  balance (`assets ≠ liabilities + equity`).

**Test convention:** report tests that assert exact figures must run in a **dedicated tenant**
(`ctx.createTenant()` + a service bound to that context) — reports aggregate the whole tenant, so
sharing the suite's tenant leaks earlier tests' journals into the numbers. This doubles as an
extra tenant-isolation assertion.

## 32. Ward Supply, Nursing, and OT modules (2026-08-20)

Three more modules on the same template (entities + migration + §25 actor derivation + status
machines + permissions + `TenantTestContext` spec), notable specifics:

- **Ward Supply** — the one module with a **balance ledger**: `receiveStock` atomically upserts
  `ward_stock_balances` (`INSERT ... ON CONFLICT (departmentId, itemId) DO UPDATE
  availableQuantity = availableQuantity + excluded.availableQuantity`) inside the same transaction
  as the `Receive` transaction row, so the ledger can never drift from the balances; `consumeStock`
  row-locks the balance and rejects over-consumption with `ConflictException`. Consumption can be
  tied to a patient/admission. The Inventory requisition→fulfillment pipeline is NOT yet wired to
  auto-post receipts (named future item, needs the store/location dimension).
- **Nursing** — two status machines on one module (tasks `Pending→InProgress→Completed` /
  `Pending→Cancelled`; MAR `Scheduled→Administered|Skipped`), all row-locked. MAR `administeredBy`
  is a clinical sign-off, so §25 actor derivation matters here exactly as it does for Lab verify.
- **OT** — `SUR-…` surgery numbers via the wrapped sequence generator; `scheduleSurgery` validates
  patient existence and, when an admission is given, that it belongs to the patient (raw-query
  cross-module validation, same as insurance).

All three wired in `app.module.ts`; permissions in `seed-rbac-catalog.ts` (Nurse finally gets its
own manage grants beyond triage); migrations `0036`–`0038`.

## 33. Maternity, CSSD, and Employee modules (2026-08-20)

Three more modules on the template (entities + migrations `0039`–`0041` + §25 actor derivation +
permissions + `TenantTestContext` spec). Notable specifics:

- **Maternity** — the "record-once delivery" rule: `recordDelivery` sets the outcome (date, type,
  baby count, complications, `deliveredBy = resolveActor(...)`) and afterwards `updateRecord` and a
  second `recordDelivery` both throw `ConflictException` — a delivery outcome is a clinical
  sign-off and cannot be silently edited. Cross-module validation (admission exists AND belongs to
  the patient) via raw query, same as insurance/OT.
- **CSSD** — instrument catalog (soft-delete, §28) plus sterilization cycles with a computed
  **sterile-expiry**: `completeCycle` sets `sterileExpiryAt = completedAt + sterileHours`; a
  deactivated instrument rejects new cycles (`ConflictException`), and cycle transitions are
  row-locked. `operatedBy` is a §25 actor field.
- **Employee** — the payroll base: `monthlyBasicSalary` is the number Payroll will compute from
  (next module), so it is validated (≥ 0) rather than free-form; `EMP-…` codes via the wrapped
  sequence generator; department validated by raw query; soft-delete.

All wired in `app.module.ts`; permissions in `seed-rbac-catalog.ts` (HR/Payroll Admin gets its
first grants via `employee.read`/`employee.manage`).

## 34. Payroll, Fraction & Incentive, and Helpdesk modules (2026-08-20)

Three more modules on the template (entities + migrations `0042`–`0044` + §25 actor derivation +
permissions + `TenantTestContext` spec). Notable specifics:

- **Payroll** — a payslip is a **snapshot, not a live formula**: `runMonthlyPayroll(month, year,
  { allowancePercent, deductionPercent })` reads each active employee's `monthlyBasicSalary`,
  computes basic/allowance/gross/deduction/net with 2dp rounding, and stores the amounts; the
  employee master can change later without rewriting history. Re-running the same period is
  idempotent (the `UNIQUE (employeeId, periodMonth, periodYear)` row is skipped, not recreated).
- **Fraction & Incentive** — money-adjacent like billing: `recordEntry` resolves the percent from
  an explicit rule (must be active and match the doctor) or the doctor's default null-department
  rule, and snapshots percent + base so later rule edits don't change recorded shares. Invoice
  existence is validated via raw query; the share math is `round(base * percent / 100)`.
- **Helpdesk** — the full lifecycle (`Open → InProgress → Resolved → Closed`) is row-locked with
  `ConflictException` naming current vs target status; the requester is the §25 actor at create
  time and the resolver at resolve time. `HLP-…` numbers via the wrapped sequence generator.

**Suite-size note:** the api suite is now ~78 suites, each provisioning tenant schemas against one
shared Postgres. Jest's default worker count parallelizes that provisioning faster than the DB can
serve it, pushing `beforeAll` past the 60s timeout — `jest.config.cts` now caps `maxWorkers: 4` so
the DB (not the timeouts) is the bottleneck. Revisit when the suite grows again or CI gets a
bigger runner.

## 35. Marketing & Referral, Social Service Unit, and Vaccination modules (2026-08-20)

Three more modules on the template (entities + migrations `0045`–`0047` + §25 actor derivation +
permissions + `TenantTestContext` spec):

- **Marketing & Referral** — the source catalog is soft-deleted (§28), and a patient referral is
  only recordable against an **active** source (`ConflictException` on a deactivated one) — the
  same "deactivated masters reject new use" rule as catalog items.
- **SSU** — charity/subsidized-care cases with a row-locked `Open → Approved/Rejected → Closed`
  machine; `subsidyPercent` is validated 0–100 (it is the write-off the hospital grants against
  bills); `SSU-…` numbers via the wrapped sequence generator.
- **Vaccination** — the first slice of the Clinical/EMR long tail: patient vaccination records
  with `administeredBy` as a §25 clinical sign-off.

These three complete PRD Phases 2–6's CRUD-style module list except Document & Print (which maps to
the reporting-export/object-storage infrastructure, not a CRUD module) and DICOM (the PACS-facing
domain that still needs its own scoping conversation).

## 36. Reporting CSV export and Prometheus metrics (2026-08-20)

Two infra completions that close named gaps and unblock ops work:

**Reporting CSV export** — `reporting-csv.util.ts` is a pure RFC 4180 serializer
(`escapeCsvField` quotes fields containing commas/quotes/newlines and doubles embedded quotes;
`toCsv` emits a header + CRLF-terminated rows). `GET /reporting/events/export.csv` exports the
whole archive matching the filters (capped at 10000 rows — an export is a bulk operation, not a
page), and `GET /reporting/dashboard/revenue/export.csv` exports the daily aggregates. Both use
Nest `@Header` decorators for content-type/disposition (no `@Res`, keeping the controllers
framework-agnostic). Note: `jsonb` payloads come back with sorted keys, so CSV tests must assert on
escaped fragments, not exact JSON strings.

**Prometheus metrics** — `@hospital/observability` now ships `MetricsService` (a prom-client
`Registry` with `collectDefaultMetrics` plus `http_request_duration_seconds` and
`http_requests_total` labeled method/route/status/tenant) and an `ObservabilityMetricsModule` with a
`MetricsController` serving `GET /metrics`. The `/metrics` route is deliberately excluded from
`AuthContextMiddleware` (scrapers can't carry JWTs; it exposes only aggregate counters — restrict at
the proxy if a deployment needs it). The HTTP timing middleware is a factory function
(`metricsMiddleware(metricsService)`) applied in `AppModule.configure` so it can inject the service
— the middleware reads `req.authContext.hospitalId` (set by AuthContextMiddleware, which runs
first) for the tenant label and `req.route.path` (set by Express) for the route label.
`docker-compose.prod.yml` gained a `prometheus` service scraping `/api/metrics` via
`deploy/prometheus.yml`.

**Still missing for full observability (tracked):** OpenTelemetry tracing, Grafana/Loki dashboards
and alert rules — load testing (Phase 3 item 9) should wait on those.

## 37. Document & Print: PDF report export (2026-08-21)

The first real consumer of `@hospital/object-storage` is verified-report PDF export for Lab and
Radiology. Pattern, codified so future Document & Print modules (discharge summaries, invoices,
certificates) follow it:

**`@hospital/pdf` platform lib** (`libs/pdf`, standalone Nx project with the standard
tsconfig trio + jest scaffold) wraps pdfmake at **0.2.20 pinned exactly** (no caret): the 0.2.x
UMD build's API is `pdfMake.createPdf(def).getBuffer(cb)` with `pdfMake.vfs = vfs_fonts` (base64
Roboto family) — 0.3.x changes both the entry-point and the `createPdf` surface and is rejected.
`PdfService.render(docDefinition): Promise<Buffer>` is the only API; it returns a Buffer (never
writes to disk). Because `pdfmake@0.2.20` ships no types and `@types/pdfmake` targets 0.3.x,
`pdfmake.d.ts` declares the `pdfmake/interfaces`, `pdfmake/build/pdfmake.js` and
`pdfmake/build/vfs_fonts.js` modules with a pragmatic surface (index signatures keep pdfmake's rich
content model permissive), and `pdf.service.ts` pulls it into the program with a **triple-slash
reference placed before the first import statement** — a `/// <reference path>` after any import is
silently ignored, and an ambient `declare module` inside a module-scoped `.d.ts` (one with a
top-level `export`) is treated as augmentation, not declaration.

**Builder/service split** — each module keeps a pure `*-report-document.ts` builder
(`buildLabReportDocument` / `buildRadiologyReportDocument`) returning a `PdfDocumentDefinition`,
unit-testable without rendering; the workflow service owns data loading and calls
`pdfService.render(...)`. Report access is gated to `Verified` requisitions (ConflictException
409 otherwise — a report must not exist pre-sign-off). The rendered buffer is mirrored to object
storage **best-effort** (`reports/lab/<requisitionNumber>.pdf` / `reports/radiology/...`): the
put is wrapped in try/catch that logs and continues — a storage failure never fails the request or
rolls back the completing workflow.

**Endpoints** — `GET /lab/requisitions/:id/report.pdf` and
`GET /radiology/requisitions/:id/report.pdf`, gated by `lab.read`/`radiology.read`, declared
**before** `@Get(':id')` so the literal `report.pdf` segment isn't captured as an id, and served
with `@Header('Content-Type', 'application/pdf')` + `StreamableFile` (a raw Buffer return would be
JSON-encoded by Nest's default serializer; `@Header` + string works for CSV but not binary).

**Module wiring** — `LabModule`/`RadiologyModule` import `PdfModule` + `ObjectStorageModule`, and
must import `DatabaseModule` (the `@Global` provider of `TenantConnectionService`/`DataSource`)
the way the other feature modules do — otherwise a standalone `Test.createTestingModule({imports:
[LabModule]})` fails DI resolution for `OrdersService → TenantConnectionService`. Tests: builder
unit specs (structure assertions against `doc.content as unknown[]` — the `PdfContent` union
doesn't support numeric indexing) plus endpoint integration specs booting `[DatabaseModule,
LabModule]` with `overrideProvider(DataSource).useValue(ctx.dataSource)`, walking a requisition to
Verified and asserting `%PDF-` magic bytes, `application/pdf`, and the 409 pre-verification guard.
Note actor fallbacks: `enteredBy` on `lab_results` is NOT NULL, so service-level setup outside the
HTTP path must pass the fallback actor explicitly (`resolveActor` still prefers the authenticated
principal when a tenant context with an accountId is active).

## 38. SaaS packages / edition tiering (2026-08-21)

Product decision: the product is sold in **editions chosen at tenant creation** — small hospitals
get a Basic set of features, medium a Standard set, large the Enterprise set, so the MVP can
launch selling only Basic while the rest of the codebase stays available to bigger tiers.

**A package is a curated set of module permission groups, enforced at JWT-issue time.** The
`packages` catalog (public schema, seeded by platform migration `0048`, like roles/permissions)
maps each tier to module keys (`basic`: 14 modules incl. radiology/employee/payroll; `standard`:
+ward-supply/nursing/OT/maternity/CSSD/vaccination/fixed-assets/helpdesk/marketing/SSU/fraction;
`enterprise`: +insurance/accounting/document-print). `tenants.packageCode` (FK, default `'basic'`)
records each tenant's tier; **pre-existing tenants were grandfathered to `'enterprise'`** by the
migration so nothing that ran before packages silently lost access, and the seeded demo/platform
tenants are created on `'enterprise'` — new customer tenants default to `'basic'` (the MVP tier).

**Enforcement is resolution-time, not registration-time.** `PackagesService.filterPermissions(
hospitalId, permissions)` intersects a role-derived permission list with the tenant's package
modules (module key → permission-name prefixes via `MODULE_PERMISSION_PREFIXES`; the always-on
`identity`/`system-admin`/`master-data`/`users`/`system` prefixes survive every package). It is
applied in `AuthService.login`/`refresh` right after `getPermissionNamesForRoles`, so an
out-of-package feature 403s via the existing `PermissionGuard` and never renders in the
permission-driven console menus — **no per-request machinery and no data partitioning; the schema
stays uniform across tenants**. The platform tenant (`__platform`) is never filtered, and an
unknown package code fails open (codes are validated at `POST /tenants` and
`PATCH /tenants/:hospitalId/package`, so an unknown row means a legacy edge case).

**Upgrade/downgrade is a single column update.** `PATCH /tenants/:hospitalId/package` swaps
`packageCode`; the change takes effect at the next login/refresh — in-flight JWTs keep their old
permission list until expiry (the same 15-minute staleness window role changes already have), and
the tenant's data is never touched. Permissions are computed fresh on every login, so there are no
permission rows to seed/revoke per package.

**Adding a module to the tiering** = add a module key to the right package in
`package-catalog.ts` (and to the `packages` seed rows for fresh environments) plus a
`MODULE_PERMISSION_PREFIXES` entry if its permission names don't already match — then re-seed or
re-run migration `0048` for existing DBs. **Not done:** the platform console's package picker
(tenant-creation form) and any self-serve upgrade — the backend contract (`GET /packages`,
`POST /tenants {packageCode}`, `PATCH /tenants/:id/package`) is ready for the frontend repo.

## 39. MVP acceptance walk, charge-capture hardening, demo seeding (2026-08-21)

Three patterns established while making the Basic-package flow "ready for MVP":

**Migration timestamps are the execution order — and they're namespaced by schema.** TypeORM
sorts pending migrations by `parseInt(migrationName.slice(-13))`, NOT by array order. This repo
namespaces the timestamp: platform migrations use `10000000000NN`
(`CreatePackagesTable1000000000048`), tenant migrations use `20000000000NN`
(`CreateVaccinationTables00472000000000047`). A new tenant migration MUST use the
`20000000000NN` suffix — a `100…`-suffixed tenant migration sorts before the billing-tables
migration, runs with `invoice_items` unresolved in the tenant schema, falls through the
`search_path` to the legacy `public` copy of the table, and creates its index in the wrong schema
(observed live: `UQ_invoice_items_source_order_item` landed in `public`; every subsequent
provisioning failed with "relation already exists"). When a migration misbehaves like this, the
fix is the name, and the stray object in `public` must be dropped by hand.

**Charge-capture is race-safe and recoverable.** `captureChargeForOrderItem` takes a per-patient
advisory lock (`SELECT pg_advisory_xact_lock(hashtext('charge_capture:<patientId>'))`) before the
find-open-invoice-then-append step — the lock is transaction-scoped (released on commit/rollback)
so it serializes concurrent first-captures for the same patient without touching unrelated
transactions or needing a schema change. Migration `0049` adds a unique partial index on
`invoice_items("sourceOrderItemId") WHERE NOT NULL`, making "one charge per order item" a DB
invariant. The recovery path is `POST /billing/invoices/charge-capture` (`reRunChargeCapture`):
it loads the order item (404 unknown, 409 not-Completed) and runs capture in its own transaction;
already-charged items return `{captured:false, reason:'already-charged'}` — safe to repeat.

**Demo seeding boots the app, and its idempotency check must run in the tenant schema.**
`database/seed-demo-data.ts` runs via `NestFactory.createApplicationContext(AppModule)` (target
`api:seed-demo-data`) rather than hand-wired services, precisely so the charge-capture and
notification subscribers are live — a service-only seeder would silently skip auto-billing. It is
idempotent by counting existing patients **inside** the tenant schema
(`tenantConnection.runInTenantSchema(m => m.getRepository(Patient).count())`): a bare repository
count on the app DataSource queries the default `search_path` (public) and would see the legacy
public tables instead. Non-HTTP callers must pass actor fallbacks explicitly wherever a NOT NULL
or CHECK-constrained actor column exists (orders.orderedBy, lab enterResult enteredBy, radiology
markScanned/verify — `CHK_radiology_requisitions_scanned_complete`/`_verified_complete` — and
payroll processedBy); `resolveActor` still prefers the authenticated principal when a tenant
context with an accountId is active.

## 40. Package-driven provisioning, audit isolation, silent-failure fix (2026-08-21)

Three fixes from the platform-console provisioning flow:

**Package-driven roles, not pickers.** Provisioning a tenant no longer asks for roles or
departments. Each package names `defaultRoleNames` (`package-catalog.ts`): Basic enables the 11
operational catalog roles, Standard adds Helpdesk Agent, Enterprise adds Patient — Super Admin is
never auto-enabled (it is a cross-tenant ops role). `TenantsService.provisionTenant` enables them
for the tenant, and `setTenantPackage` add-only reconciles the new package's roles on
upgrade/downgrade (switching a role off stays an explicit platform-console action). **Gotcha
fixed along the way:** the `Tenant.roles` `@ManyToMany` cascade on `repository.save()` silently
no-ops for detached Role rows — `tenant_roles` stayed empty even though the response echoed the
roles. The join rows are now inserted explicitly (raw `INSERT ... ON CONFLICT DO NOTHING`, the
same path `setTenantRoles` uses). This was live-verified: a Basic tenant ends up with exactly the
11 default roles, none of them Super Admin.

**Audit writes must never use the caller's EntityManager.** The audit subscriber always passed
`event.manager` to the publisher, so an audit record for a save of a GLOBAL (public-schema)
entity — `tenants`, `roles`, `packages` — was written inside that transaction with
`search_path = public`. Before the public-schema cleanup it landed silently in the stale
`public.audit_records`; after the cleanup the insert threw "relation does not exist", and a
Postgres error aborts the enclosing transaction even when the JS exception is caught — tenant
provisioning 500'd and the tenant_roles insert then failed its FK. `PersistingAuditEventPublisher`
now always writes on its own connection via `runInTenantSchema` (the passed manager is ignored),
so a tenant-creation audit row lands in the operator's schema and a failure can never roll back
the business write (the orphan-on-rollback tradeoff the reporting publisher already documents).
The end-to-end spec boots the real AppModule and provisions a tenant to pin this.

**Platform console errors are visible now.** The tenant-list provision handler swallowed errors
("In a real app we might show a toast here") — that is why a failed creation showed nothing. The
modal now renders the backend message via `p-message`, and the form only asks for hospital
name/id + package, with a note that roles follow the package.

## 41. Super Admin is platform-only (2026-08-21)

Cross-tenant roles (Super Admin) must never be enable-able for a hospital tenant. Two layers:

**Role-assignment guards.** `TenantsService.provisionTenant` (explicit `roleIds` path) and
`setTenantRoles` both reject any role with `isCrossTenant = true` (400, "platform-only");
`resolvePackageDefaultRoles`/`addPackageDefaultRoles` filter them out as belt-and-braces, and
`seed-initial-setup`'s `enableAllCatalogRoles` excludes them (existing dev DBs had the demo's
Super Admin `tenant_roles` row removed by hand).

**Permission filtering.** `system-admin.tenants.manage` was removed from
`ALWAYS_ON_PERMISSION_PREFIXES` in `package-catalog.ts`. It only survives
`PackagesService.filterPermissions` for the platform tenant (which is never filtered), so even if
a Super Admin role were somehow enabled on a customer tenant, staff JWTs there would NOT carry
tenant-management powers. Frontend: the tenant-detail "Available roles" list filters out
`isCrossTenant` roles (with a note) so they can't be toggled on by mistake; the backend guard
remains the authority.

## 42. Bootstrap admin at provisioning + package role annotations (2026-08-21)

**Every tenant gets its Hospital Admin account at provisioning** — the platform admin's only job;
the hospital admin then creates all further staff. `POST /tenants` accepts optional
`adminUsername`/`adminEmail`/`adminPassword`; when omitted it generates `admin.<hospitalId>` and a
12-char base64url password and returns them once in the response as `adminCredentials`
(`needsPasswordUpdate: true` when generated). This fixed a chicken-and-egg: a newly provisioned
tenant previously had no login path at all (account creation requires a session). The platform
console shows the generated credentials in a panel that stays open until copied.

**Role annotations.** `GET /packages` now merges `defaultRoleNames` from the code catalog
(`package-catalog.ts`) into the DB rows, so the console can render each role in the tenant-detail
list as *"Included in <package>"* (the tenant's current package enables it by default) or
*"Manual"* (switched on by hand). The annotation follows the tenant's current package — on a
package change the new package's roles get added automatically (see §40), and the labels update.

## 43. Secure staff account creation: generated initial passwords + must-change-password onboarding (2026-08-21)

**Staff account creation is now the frontend's only job after provisioning** — `POST /accounts`
(any tenant) takes an optional `password`; when omitted, `AccountsService.createStaffAccount`
generates a random 12-char base64url initial password and returns it **once** in the response
(`initialPassword`), with `needsPasswordUpdate: true`. A supplied admin password means no forced
change; the client cannot forge `needsPasswordUpdate: false` to suppress the forced change on a
generated password (the service ignores the flag when no password was sent). The old hardcoded
`ChangeMe123!` frontend default — a standing backdoor since the password was known to everyone —
is gone; the create-user modal shows the generated password in a keep-open panel (same pattern as
§42's bootstrap-credentials panel).

**Role validation at creation** (`createStaffAccount`): unknown role → 400; cross-tenant role
(Super Admin) → 400 for any hospital tenant (the platform-tenant bootstrap passes an internal
`allowPlatformRole` flag the HTTP controller always forces to `false`, so a crafted body can never
set it); role not enabled for the tenant (checked against `tenant_roles` for real registry tenants,
fail-open for schema-only test tenants like `filterPermissions`) → 400. A crafted request can no
longer mint a Super Admin.

**Must-change-password flow.** Login with an account flagged `needsPasswordUpdate` returns HTTP
403 `{mustChangePassword: true}` and issues **no tokens**; `/auth/refresh` also rejects such
accounts, so a pre-change refresh token cannot bypass the gate. The onboarding endpoint
`POST /auth/change-password` is unauthenticated (excluded from `AuthContextMiddleware` like login),
authenticates with username + current password (same proof as login — wrong/missing credentials
both 401 without revealing which), and **only accepts accounts still flagged must-change** (400
otherwise); it replaces the password and clears the flag. Regular logged-in rotation stays on the
authenticated `POST /accounts/me/password` (`changeOwnPassword`, current-password verified). The
Angular client treats `/auth/change-password` like `/auth/login` in the auth interceptor — no
Bearer token, no refresh-on-401 — so a wrong current password can't trigger the session-clear
redirect; the `LoginOutcome` union gained a `mustChangePassword` kind and the login screen routes
to an unguarded `/change-password` route (outside both shells, prefilled with the username) that
validates length/confirmation client-side before calling the endpoint.

**Platform tenant is tenant-agnostic** (2026-08-21, follow-up): the platform console shares the
same staff-account screens as hospitals, but its operators are not package-gated — `listRoles()`
skips the `tenant_roles` join for the platform tenant, so `GET /accounts/roles` returns the whole
catalog (all 14 roles, including the cross-tenant Super Admin), and `createStaffAccount` allows
cross-tenant roles there (a platform admin can create further Super Admin operators). Hospital
tenants are unchanged: Super Admin creation/assignment → 400. `assignRole` carries the same two
guards as `createStaffAccount` (cross-tenant → 400; role must be enabled for registry tenants),
so the picker-vs-API disagreement is closed on the assign path too. "The platform tenant" resolves
through `resolvePlatformTenantId()` (`tenants/platform-tenant.ts`), which honors the test-only
`PLATFORM_ADMIN_TENANT_ID` env override so specs exercise platform behavior against a throwaway
tenant instead of the real `__platform` schema (same mechanism `seed-initial-setup` uses).

**Platform roles are platform-only, not "the whole catalog"** (2026-08-21, correction): the
platform role picker offers exactly the cross-tenant roles — today just **Super Admin** — never
hospital roles like Doctor/Nurse. Offering hospital roles in the platform tenant was meaningless
and a privilege leak: `filterPermissions` is platform-exempt, so a "Doctor" platform account
would have received every permission in its JWT. `listRoles()` in the platform tenant filters
`isCrossTenant = true`; `createStaffAccount`/`assignRole` reject a hospital role there with 400
(the mirror image of rejecting Super Admin in a hospital tenant), keeping the picker and the API
in agreement in both directions.

## 44. Role catalog is Super Admin only — hospital admins map roles, never create them (2026-08-21)

**The global role catalog (`GET/POST /roles`) is a platform-only concern.** A hospital admin's job
is to *map* (assign) roles to users through the tenant-scoped `GET/POST /accounts/roles` picker
(which returns only the roles the tenant's package/provisioning enabled — or just Super Admin in
the platform tenant). Creating or listing catalog roles used to require `master-data.manage`,
which is always-on for customers, so any hospital admin could call the API directly and create
roles in the shared catalog (even `isCrossTenant` ones) even though the Global Catalog screen only
exists in the platform console.

**Fix:** new `rbac.manage` permission (`seed-rbac-catalog.ts`), mapped to **Super Admin only** and
deliberately *not* in `ALWAYS_ON_PERMISSION_PREFIXES`, so no customer tenant can ever hold it;
`RoleManagementController` requires it on both endpoints. Re-seeding is idempotent
(`nx run api:seed-rbac`), and a live Super Admin picks it up at next login (JWT 15m).
**Rule of thumb for platform-only powers:** gate them with a permission mapped to Super Admin
only (like `system-admin.tenants.manage` and `rbac.manage`) rather than reusing an always-on
customer permission — otherwise the API surface silently outruns the console.

## 45. Platform-console gaps: password reset, role revocation guard, tenant history (2026-08-21)

**Admin password reset.** `POST /accounts/:id/reset-password` (permission: `identity.accounts.manage`)
is the forgotten-password path: it always flags the account must-change on next login and clears
lockout state (`failedLoginAttempts`/`lockedUntil`) so the user can actually sign in. With no body it
generates a one-time initial password returned in the response (shown once, same rule as
`createStaffAccount`); an optional `{ password }` uses the admin's temporary password as-is but
still forces the change — a reset is *recovery*, unlike create where an admin-chosen password is the
real password. The controller defaults the DTO (`@Body() body: ResetPasswordDto = {}`) — a bodiless
POST otherwise crashes on `body.password`.

**Platform lockout guard.** `revokeRoleAssignment` refuses to deactivate the **last active Super
Admin** in the platform tenant (400) — removing it would leave no operator able to administer the
platform. Hospital tenants are unaffected; the UI surfaces the backend message on the remove-role
chip action.

**Auditable tenant history, and the recordId bug it exposed.** `GET /audit` accepts `recordId`, so the
tenant-detail "Platform history" panel lists the platform trail's events for one hospital
(provisioned / package changed / suspended) — platform-side data only, no cross-tenant reads.
Making that work exposed a real audit bug: `AuditSubscriber` derived the record id from a hardcoded
`entity['id']`, but the `Tenant` entity's primary key is `hospitalId`, so **every tenant audit row
was written with an empty recordId**. The subscriber now resolves the id from
`event.metadata.primaryColumns` (joined with `:` for composite keys), so tenant events correlate
correctly. Historical empty rows cannot be backfilled (no tenant identifier was stored).
**Rule:** never hardcode `entity['id']` for audit correlation — use the entity's real PK metadata.

## 46. Global catalog edit + deactivate; department catalog is platform-only (2026-08-21)

**The Global Catalog is no longer create-only.** Roles: `PATCH /roles/:id` edits
description/priority (the **name is immutable** — renaming would orphan `tenant_roles` and
account-role references); `PATCH /roles/:id/deactivate|reactivate` soft-removes a role.
Deactivation semantics: pickers (`AccountsService.listRoles`) and new assignments stop offering
the role (`createStaffAccount`/`assignRole` reject inactive roles with 400), while **existing
account assignments keep working until revoked** — deactivation is a catalog-level "no longer
offered", not a mass-revocation. Cross-tenant roles (Super Admin) can never be deactivated (400);
the Global Catalog UI hides the toggle for them. Department catalogs: `PATCH
/catalogs/departments/:id` edits name/description/appt (code immutable) plus deactivate/reactivate.

**Department catalogs are platform-only.** They used `master-data.manage` — the same always-on
hole the role catalog had — so any hospital admin could create/edit the shared department
templates via the API. Both catalog controllers now require `rbac.manage` (Super Admin only);
the permission-gating spec proves a `master-data.manage`-only token gets 403 on every catalog
endpoint. Rule: every endpoint behind a platform-only console screen must be gated by a
Super-Admin-only permission — `master-data.manage` covers *tenant* departments/wards, never the
global catalog.

## 47. Tenant deletion & retention: archive (soft) + purge (hard), and the suspend-login bug (2026-08-21)

**Lifecycle:** `active` → `suspended` (reversible, blocks login) → `archived` (soft-delete,
reversible, blocks login, data kept) → `purged` (irreversible). Archive is the deletion path for
churned hospitals: `PATCH /tenants/:id/archive` sets `status='archived'` + `archivedAt`
(migration 0050), keeps the schema and all data, and `restore` returns to active. **Purge** is
hard and deliberate: only an **archived** tenant, and `confirmHospitalId` must exactly match
(`PATCH /tenants/:id/purge` with `{ confirmHospitalId }` — PATCH because the frontend API client
has no DELETE-with-body). It drops the schema + role + registry row via **loaded-entity
`remove()`, not `repository.delete()`** — `delete()` bypasses the audit subscriber, so the
destructive action would be untraceable; `remove()` records a 'delete' event in the platform
trail (which lives in `tenant___platform` and survives the drop). Retention policy: **no
auto-purge** — archived data is kept indefinitely; purge is manual + typed-confirmation only.

**The suspend-login bug it exposed:** `suspendTenant` only set the status column — `AuthService`
never checked tenant status, so suspended hospitals kept working. Login and refresh now gate on
the registry row (`TenantsService.getTenantStatus`, fail-open for schema-only test tenants,
platform tenant exempt): suspended/archived → login 403 `{tenantInactive, reason}` (frontend
shows the message via the serverError path), refresh → `invalidToken`. Rule: any tenant-status
change must be enforced at the auth boundary, not just stored on the row.

**Follow-up fix (2026-08-21, found by the §48 code-review pass):** `suspendTenant` and the older
`reactivateTenant` (both pre-dating archive/restore, still routed at `/suspend`/`/reactivate`
alongside the newer `/archive`/`/restore`) never accounted for the `archived` state added above —
`suspendTenant` had no guard against an already-archived tenant (would silently flip
`archived → suspended` while leaving `archivedAt` stale), and `reactivateTenant` doesn't clear
`archivedAt` the way `restoreTenant` does. Both now reject an archived tenant with 400, directing
the caller to `restore` first — keeping "archived" a single well-defined state machine reachable
only via `archive`/`restore`, rather than two endpoint pairs racing to mutate overlapping status
values. Regression test added to `tenants.controller.integration-spec.ts`.

## 48. Platform subscription/billing: the SaaS vendor's own billing for hospital tenants (2026-08-21)

**Pattern: platform billing is a public-schema module, structurally identical to `packages` and
`tenants`, not a tenant-scoped domain module.** `subscriptions`/`subscription_invoices` (migration
`0051`) live in `public`, gated by the same `system-admin.tenants.manage` permission as tenant
management, and are never reachable from a hospital tenant's own JWT — `PlatformBillingController`
lives at `platform/billing/*`, mirroring `platform-tenant.ts`'s reserved `__platform` exemption
from package filtering. This is the platform selling packages to hospitals, not a hospital billing
its own patients (that's the existing tenant-scoped `billing` module) — two unrelated domains that
happen to share the word "billing."

**Price source of truth lives in the package catalog, not the subscription row.**
`PACKAGE_CATALOG` (`packages/package-catalog.ts`) gained `priceMonthly`/`priceAnnual` per edition
(₹4,999/54,000 Basic, ₹9,999/108,000 Standard, ₹19,999/216,000 Enterprise — placeholder figures
agreed with the product owner). `SubscriptionBillingService.subscribe()` resolves the price from
the tenant's *current* `packageCode` at subscribe/renew time and **denormalizes it onto the
subscription row** (`pricePerCycle`) — so a later catalog price change never retroactively
reprices an existing subscription's already-quoted rate; only the next `subscribe()` call (a new
subscription or a cycle change) picks up a new list price.

**Manual invoice issue, not scheduled billing.** There is no cron/scheduled job — a platform
operator calls `POST .../invoices` to issue an invoice for the subscription's *current* period
on demand. **One open invoice per period** is enforced at the service layer (a `findOne` check
before insert) inside the same per-tenant advisory-locked transaction as `subscribe`/`cancel` —
see the post-review hardening note below.

**Mark-paid advances the period — this *is* the renewal mechanism.**
`markInvoicePaid` is transactional: flips the invoice to `paid` and, if the subscription is still
`active`, moves `currentPeriodStart`/`currentPeriodEnd` forward by one cycle from the *paid
invoice's* `periodEnd` (not from `now`) — so a late payment doesn't shrink the next period. There
is no separate "renew" endpoint; issuing the next invoice against the new period is how billing
continues. A canceled subscription's period does **not** advance on a stray mark-paid (matches
`packages`/tenant-role patterns: cancellation prevents new business, existing invoices settle
normally).

**Frontend: a dedicated `SubscriptionsApiService`, not folded into `TenantsApiService`.** Same
per-domain-service convention as `InvoicesApiService` (see this file's screen-building
conventions) — billing has its own HTTP shape (subscription + invoice list, distinct action verbs)
and is conceptually a different resource than tenant CRUD even though both live on the tenant
detail screen. The Billing panel (`tenant-detail.html`) follows the existing Package/Roles panel
layout: a subscription card (package, cycle, price, current period, Subscribe/Update-cycle/Cancel)
plus an invoices list (Issue Invoice, Mark Paid per open row) — `subscribe()` doubles as both
"start a subscription" and "change the billing cycle" since the backend already treats them as the
same operation (see above), so the frontend never needs a separate update-cycle endpoint.

**Post-review hardening (2026-08-21, high-effort `/code-review` per this money-touching item's
risk gate):** the first cut of `subscribe`/`cancel`/`issueInvoice` each did an independent
find-then-write with no lock, so two concurrent calls for the same tenant could both pass a
pre-write check and both act — a double-issued invoice hitting the unique index as an unhandled
500 instead of the intended 409, or (worse) two simultaneously-`active` subscription rows for a
never-before-subscribed tenant. Fixed by wrapping all three in one transaction with a per-tenant
`pg_advisory_xact_lock(hashtext('platform_billing:<tenantId>'))` — same transaction-scoped,
schema-free pattern as billing's charge-capture lock (§27) — so the three operations now fully
serialize per tenant. `markInvoicePaid` got the equivalent invoice-scoped lock (keyed by
`invoiceId`, since it doesn't contend with the tenant-scoped ops) to close a second race: two
concurrent mark-paid calls on the same invoice could both observe `status: 'open'` and both
process it. Also fixed a genuine logic bug independent of concurrency:  `markInvoicePaid`
advanced the period using the *subscription's current* `billingCycle`, but `subscribe()` can
change that cycle in place after an invoice is issued and before it's paid — so a monthly-priced,
monthly-issued invoice paid after a cycle switch to annual would grant a 365-day period. Fixed by
deriving the granted period length from the **paid invoice's own** `periodStart`/`periodEnd`
instead of re-deriving it from `CYCLE_MS[subscription.billingCycle]` — the period granted now
always matches what was actually invoiced and paid for, regardless of what the cycle became
afterward. 3 new regression tests exercise all three fixes directly (concurrent issue → one 409,
concurrent mark-paid → idempotent, cycle-switch-between-issue-and-pay → correct period length).

## 49. Reporting PDF export, and the shared `@hospital/pdf` document-builder pattern (2026-08-22)

`GET /reporting/events/export.pdf` closes the last gap in item 10's reporting APIs (CSV shipped
2026-08-20; PDF was deferred as lower-priority, not unwanted). Same filter shape and 10000-row cap
as `export.csv`, `reporting.read`-gated, `application/pdf` via `StreamableFile` +
`Content-Disposition: attachment`.

**Reused, not reinvented: the Lab/Radiology PDF pattern.** `reporting-events-pdf-document.ts`
follows `lab-report-document.ts`/`radiology-report-document.ts` exactly — a pure function
(`(data) => PdfDocumentDefinition`, zero pdfmake dependency, unit-tested without rendering) that
`ReportingQueryService` feeds into the shared `PdfService.render()`. Same brand/style vocabulary
(VAIDYA teal `#006D77` header, `tableHeader` fill `#E8F5F5`) so every PDF this codebase produces
reads as one system, not three independently-styled exports. `PdfModule` wired into
`ReportingModule` the same way `lab.module.ts`/`radiology.module.ts` already do it.

**One deliberate difference from Lab/Radiology: landscape orientation + small fonts (7–8pt).**
Lab/Radiology reports are one record with a handful of table rows — portrait fits comfortably.
Reporting's export is a wide, many-row table (occurredAt/eventType/entityId/correlationId/payload,
up to 10000 rows) — landscape plus compact fonts keeps every column legible instead of forcing an
unreadable wrap. Establishes the convention for any future wide-table PDF export in this codebase:
match Lab/Radiology's brand/style tokens, but let orientation and font size follow the data shape.

**Test rigor stayed at the CSV sibling's level, not Lab/Radiology's.** The CSV export
(`reporting-csv.integration-spec.ts`) is tested at the service level only (`exportEventsCsv`
called directly against a real tenant schema) — no HTTP-level Nest app boot, unlike
`lab-report-pdf.integration-spec.ts`'s full `supertest`-driven flow. The new
`reporting-pdf.integration-spec.ts` matches that established lighter-weight pattern rather than
introducing a heavier one for a single sibling endpoint: magic-byte assertion (`%PDF-`), filter
application, and tenant isolation, all via direct service calls. `reporting-events-pdf-document.spec.ts`
covers the pure builder's structure (brand/title, header + per-row table body, the
filters-summary line appearing only when a filter is active) the same way
`lab-report-document.spec.ts` covers Lab's.

## 50. Insurance frontend page (2026-08-22)

The `insurance` backend module (payers, policies, claims lifecycle, coverage check — §
`pending-tasks.md` Phase 3) shipped with no frontend page; this closes that gap in the frontend
repo (`apps/staff-console/src/app/insurance/`).

**Follows the Reporting-dashboard shape, not a new one.** One routed component
(`insurance-dashboard/`) with `p-tabs` for the three sub-resources (Payers/Policies/Claims), same
as `reporting-dashboard/`'s Overview/Events split — a single feature page for a module with
several related-but-distinct sub-resources doesn't need three separate routes. Payers reuse the
create+edit+deactivate/reactivate CRUD pattern from `global-catalog-list.ts` (Roles/Departments);
Policies and Claims reuse the `p-table` lazy/server-paginated pattern from `invoice-list.ts`
(`[lazyLoadOnInit]="false"` + explicit first load, per this file's screen-building conventions).

**Pagination envelope: `{data, meta}`, not the Reporting/Invoice bespoke shapes.** Both
`listPolicies`/`listClaims` on the backend go through the shared `@hospital/pagination`
`paginate()` helper, whose actual return shape is `{ data: T[], meta: { total, page, limit,
totalPages } }` — matching `audit.model.ts`'s `PaginatedResponse<T>` (used by the platform
tenant-history panel), not `InvoiceListResult`'s flattened `{data, total, page, limit}` (an older,
pre-`@hospital/pagination` shape specific to billing) or Reporting's bespoke `{items, total}`.
Verified against the actual `paginate()` implementation (`libs/pagination/src/utils/paginate.ts`)
rather than assumed from a sibling screen — the three list-envelope shapes already live side by
side in this codebase and picking the wrong one only fails at runtime, not typecheck, since all
three are structurally plausible TypeScript interfaces.

**Money-adjacent actions (Approve/Reject/Mark Paid) reuse existing, already-reviewed backend
endpoints — no new backend logic, so this shipped without a dedicated `/code-review` pass.** The
repo's risk-gated review rule applies to money-*handling logic*; this page is a UI consumer of
claim-lifecycle endpoints that predate it (§ Phase 3, migration `0034`, 8 backend tests already in
place). The full lifecycle (payer create → policy create → coverage check → claim create → submit
→ approve → pay) was live-verified end to end against the dev API instead, using a temporarily
enterprise-upgraded demo tenant (Insurance is Enterprise-package-gated; reverted after
verification) — confirming the frontend's request/response shapes match the live backend exactly,
which is the failure mode a review would otherwise be checking for on a pure consumer page.

**Nav placement:** a standalone top-level "Insurance" link (like "Invoices"), not inside a new
"Finance" section — Accounting and Fixed Assets are still frontend-less (per `pending-tasks.md`),
so a dedicated Finance nav section would currently hold one item. Revisit grouping once a second
finance-domain page ships.

## 51. Per-tenant branding (2026-08-22)

Platform-admin-configured, tenant-scoped white-label config — display name, primary color, logo —
so each hospital's console and login page feel like their own product rather than all identically
"Vaidya." Design per `claude-code-tasks.md` 2.12: public-schema table (`tenant_branding`, migration
`0052`), gated by `system-admin.tenants.manage`; unconfigured tenants (and the platform tenant,
always) fall back to the default Vaidya brand.

**Two read paths, deliberately different trust models.** Platform-admin CRUD
(`GET/PUT /platform/tenants/:hospitalId/branding`, `POST/DELETE .../logo`) is authenticated and can
target any hospitalId explicitly. The tenant-facing read (`GET /branding`) is public and
unauthenticated — resolved from `x-tenant-id` (not a JWT), because the login page needs to render
branding *before* any session exists, the same problem `/auth/login` already solves by being
excluded from `AuthContextMiddleware`. This is not a cross-tenant leak: the header only ever names
the caller's own tenant (same trust model login/refresh already rely on), and what it exposes
(display name, a color, a logo) is exactly what an anonymous visitor to that hospital's login page
already sees — no different in sensitivity than a company's public homepage branding.

**Two disconnected route-exclusion lists, not one — a real gap this feature exposed.**
`AuthContextMiddleware`'s exclusion list lives in `app.module.ts`; a *second*, independent list
(`TenantContextMiddleware`'s `EXPECTED_FALLBACK_PATH_SUFFIXES`,
`libs/tenant-context/src/lib/tenant-context.middleware.ts`) exists purely to suppress a security-
monitoring warning log for routes where header-based tenant fallback is expected rather than
suspicious. Adding `/branding` to only the first list (needed for the route to work at all) still
left every legitimate login-page load logging a spurious "tenant context fallback to headers
detected" warning, because the second list didn't know about the new exclusion. Both are now
updated, cross-referenced by comment. **Any future `AuthContextMiddleware` exclusion needs the same
second edit** — a `@Public()`-style route-metadata decorator read by both middlewares (matching the
`RequirePermission`/`PermissionGuard` `Reflector` idiom `@hospital/auth-guards` already
establishes) would collapse this to one declaration instead of two files to remember; not done here
since this is the second-ever exclusion pair (after login/refresh) and a single follow-up comment
was deemed enough for now. Revisit if a third public route needs one.

**Money-adjacent concurrency pattern reused from §48's post-review hardening, applied proactively
this time.** `upsertBranding`/`uploadLogo`/`removeLogo` serialize per tenant with the same
transaction-scoped `pg_advisory_xact_lock(hashtext('platform_branding:<tenantId>'))` pattern
`subscription-billing.service.ts` was hardened with after its own first-cut review — `tenantId` is
this table's primary key, so two concurrent first-time writes (a double-clicked Save, two open
admin tabs) would otherwise race a plain find-then-insert into a raw primary-key violation instead
of a clean update. Applied from the start here rather than found by a second review pass.

**File upload: this is the first multipart endpoint in this backend**, and both memory-safety
layers matter, not just one. `MAX_LOGO_BYTES` (2MB) is enforced twice: once at
`FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES } })` so multer itself refuses to
buffer an oversized upload into memory in the first place, and again in the service layer as a
defensive re-check. The interceptor-level limit is the one that actually bounds memory pressure — a
service-layer-only check still lets an attacker's full oversized payload get buffered before
rejection, a real (if minor) DoS-shaped gap that a review pass on the first cut of this file caught.
Also: no `@types/multer` — this app's `tsconfig.app.json` restricts `types` to `["node"]` (a
protected file), so the package's global `Express.Multer.File` augmentation never gets included
regardless of whether it's installed; a local `{ buffer, mimetype, size }` interface covering only
the fields actually read is simpler than fighting that restriction.

**Not consolidated (flagged, not fixed): three independent "is this tenant real, non-platform,
brandable/billable" guards now exist** — `TenantsService.loadMutableTenant` (archive/restore/purge),
`SubscriptionBillingService.tenantRow` (§48), and `PlatformBrandingService.assertBrandableTenant`
(this section) — each with slightly different wording and, in billing's case, a different data-
access path entirely (`PackagesService.getTenantPackageCode`'s raw query builder, not
`TenantsService`). A shared `TenantsService.assertRealTenant()` promoted to `public` would collapse
this to one source of truth. Not done in this pass — noted as a follow-up rather than expanding this
feature's diff into a cross-module refactor.

**Frontend: CSS custom-property override, not a rebuilt PrimeNG preset.** `VaidyaTealPreset`
(`app.config.ts`) is a static `providePrimeNG` DI provider configured at bootstrap — it can't be
reconstructed per-tenant after an async branding fetch without a bootstrap-order chicken-and-egg
problem. Instead, `BrandingService.applyCssVariables()` generates a full 50-950 tint/shade ramp from
the tenant's one chosen hex (a small local color-mixing utility, not a dependency) and overrides the
same `--p-primary-*`/`--p-highlight-*` custom properties the preset defines — confirmed these are
genuinely live CSS variables, not baked literals, because this app's own hand-rolled Tailwind
classes (`accent-bg`, `nav-item-active` in `styles.css`) already resolve `bg-primary-600` etc. from
these same variables via `tailwindcss-primeui`, so one override re-themes both PrimeNG components
and this app's own classes at once. Loaded via `provideBrandingBootstrap()` (`provideAppInitializer`,
mirroring `provideAuthBootstrap`'s exact pattern) so there's no flash of the wrong brand before the
real one applies, and the platform console (admin subdomain) skips the fetch entirely rather than
relying on the response resolving to nulls.

## 52. Global `ValidationPipe` — Phase A, whitelist deliberately deferred (2026-08-22)

Closed the gap flagged by `claude-code-tasks.md` 2.14 (found while fixing 2.13's payroll 500): no
`ValidationPipe` — global or per-route — was registered anywhere in `apps/api`, so every
`class-validator`/`class-transformer` decorator on every DTO was dead code, compiling and
typechecking but never running. Design in
`new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md`.

**Re-auditing the blast radius changed the design.** Only 9 of 104 `*.dto.ts` files under
`apps/api/src` carry any `class-validator` decorator — the other 95, including the widely-reused
`PaginationQueryDto` (`libs/pagination`), are plain classes with typed-but-undecorated fields.
`ValidationPipe`'s `whitelist: true` strips any field with **zero** validation decorators, not just
unrecognized ones — so enabling it globally today would have silently reduced all 95 undecorated
DTOs' request bodies to `{}`. That's the real reason this needed the heavyweight pipeline rather
than a one-line fix: not "the pipe rejects some requests" but "the pipe deletes almost every request
body in the app." Split into two phases; only Phase A is done:

- **Phase A (done):** `app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: {
  enableImplicitConversion: true }, whitelist: false, forbidNonWhitelisted: false }))`. Activates
  the 9 already-decorated DTOs' validators for real, and coerces typed-but-undecorated numeric/
  boolean fields (via reflected `design:type` metadata, `emitDecoratorMetadata` already being
  repo-wide) without adding a single decorator anywhere. Zero behavior change on the other 95 DTOs.
- **Phase B (deferred, `claude-code-tasks.md` 2.18):** audit and decorate the remaining 95 DTOs
  against their real request payloads, then flip `whitelist`/`forbidNonWhitelisted` on. That's the
  actual "every controller validated, unexpected fields rejected" hardening — kept separate because
  of its size and risk, not because it's optional.

**Shared pipe factory, not inline construction — because integration specs bypass `main.ts`
entirely.** Every existing integration spec builds its own `INestApplication` via
`Test.createTestingModule(...).createNestApplication()` and never calls the production
`bootstrap()` in `main.ts`, so a pipe registered only there is invisible to every test. Extracted
`createApiValidationPipe()` (`apps/api/src/app/api-validation-pipe.ts`), imported by both `main.ts`
and the new `global-validation-pipe.integration-spec.ts` (which boots the real `AppModule` the same
way `app-module-auth-wiring.integration-spec.ts` does, then explicitly adds
`app.useGlobalPipes(createApiValidationPipe())` — matching what `main.ts` does, not assuming it).
Same shape as `resolveJwtSecret()` in `auth/jwt-secret.ts`: a small function shared between
production bootstrap and tests, rather than either duplicating config or leaving it untested.

**Test-writing lesson: check for redundant service-level guards before claiming a pipe test proves
anything.** The three `UpdatePriceDto` price-update services (lab/radiology/inventory) already had
their own manual `Number.isFinite(price) && price >= 0` checks predating this pipe — so a test
asserting "negative price returns 400" passes identically whether the pipe exists or not, and
doesn't actually demonstrate the fix. The tests that do are ones with no redundant guard: an
array-valued `patientId` (from a repeated query key, `?patientId=a&patientId=b`) on
`ListInvoicesDto`'s `@IsString()` — previously reaching `InvoicesService.list()`'s TypeORM
`andWhere` unguarded (a likely 500 from the DB driver), now a clean 400 from the pipe — and a
non-numeric `page` on `SearchAuditRecordsDto` (`@Type(() => Number) @IsInt()`), previously silently
accepted since the decorator never ran.

## 53. Global `ValidationPipe` — Phase B: decorate all 104 DTOs, enable `whitelist` (2026-08-22)

Closed out `claude-code-tasks.md` 2.18, the deferred half of §52: decorated the remaining 95 DTOs
under `apps/api/src` (plus the shared `PaginationQueryDto` in `libs/pagination`) and flipped
`whitelist: true` in `apps/api/src/app/api-validation-pipe.ts`. `forbidNonWhitelisted` stays off —
an unrecognized field is silently dropped, not rejected, the more conservative choice for a change
touching every controller in the app at once.

**Parallelized the mechanical decoration work, kept the security/money-sensitive DTOs personal.**
19 DTOs under `auth/`, `accounts/`, `rbac/`, `tenants/`, `platform-billing/`, `platform-branding/`,
and `billing/` were decorated by hand in this session rather than delegated; the other 76 were split
across 4 parallel background agents given an identical, deliberately strict rule set (map each TS
type to its decorator, `@IsOptional()` only on `?`-marked fields, never invent a business-rule
constraint like `@Min`/`@MaxLength` unless the owning service already enforces it, skip and report
nested-object/array-of-DTO fields rather than guess at `@ValidateNested` wiring). Two of the first
four agent launches hit a session-wide API rate limit partway through and had to be relaunched with
recomputed remaining-file lists — every agent's output was spot-checked against its own diff before
being trusted, catching one real bug an agent introduced (see below) before it reached typecheck.

**The recurring bug across almost every agent batch: `import type` for type-only enum imports.**
`tsconfig.base.json`'s `isolatedModules` + `emitDecoratorMetadata` means a value imported purely as
a type annotation (a string-literal union like `AccountType`, or an entity's exported type alias)
must be `import type { X }`, not a plain `import { X }`, the moment any property in the class gets a
decorator — `emitDecoratorMetadata` tries to emit `design:type` for every decorated property, and a
type-only value can't satisfy that as a normal import (`TS1272`). Every agent batch produced at
least one of these; all were straightforward one-line fixes once `tsc --build` pointed at the exact
line. This is the same class of gotcha `new/code/CLAUDE.md` already documents for constructor
parameters — it turns out to apply identically to any class property once a decorator is present.

**`@IsIn([...])` vs `@IsEnum(X)` — string-literal unions are not runtime enums.** Nearly every
"enum-like" field in this codebase (`AccountType`, `InsurancePayerType`, `SterilizationMethod`,
`EmploymentType`, `FixedAssetCondition`, `HelpdeskTicketPriority`, `NotificationType`, `DeliveryType`,
etc.) is `export type X = 'A' | 'B' | 'C'`, not a TypeScript `enum`. `@IsEnum()` needs a real runtime
object to validate against; these get `@IsIn([...])` with the literal values instead, and the type
import must be `import type` per the point above. Zero real TS `enum`s existed anywhere in the DTOs
touched by this pass — worth knowing before reaching for `@IsEnum` reflexively on the next one.

**Nested arrays of DTOs need `@ValidateNested({ each: true }) + @Type(() => X) + @IsArray()` on the
parent field, not just decorators on the child class.** `whitelist: true` only recurses into a
nested object if the pipe is told to validate it there in the first place — decorating
`CreateInvoiceItemDto`'s own fields does nothing for `CreateInvoiceDto.items: CreateInvoiceItemDto[]`
unless the array field itself carries this three-decorator combination. Six fields across
`accounting.dto.ts`, `create-patient.dto.ts` (×2), `create-purchase-order.dto.ts`,
`create-stock-requisition.dto.ts`, `create-order.dto.ts`, and `create-invoice.dto.ts` needed this;
every agent was told to skip-and-report rather than guess at nested wiring, and one (`accounting.dto.ts`)
was missed by an agent that failed before it could file its report — caught by grepping the whole
tree for `: \w+Dto\[\]` and cross-checking each hit had the three decorators, after the agent batches
finished, not by trusting any single batch's self-reported completeness.

**Controllers using an inline `@Query()` intersection type (`PaginationQueryDto & SomeDto`, or
`PaginationQueryDto & { foo?: string }`) get zero validation regardless of decorators or `whitelist`
— found in 3 places (`cssd`, `fixed-assets`, `insurance`), fixed by making the DTO class itself
`extends PaginationQueryDto`.** An intersection of two classes (or a class and an inline object
type) has no single runtime constructor, so Nest's `ValidationPipe` can't resolve a `metatype` for
it and silently skips the parameter entirely — not a `whitelist`-specific regression, since this
was already broken before Phase A, but the review that closed out this task is what surfaced it
(grep for `@Query() query: .*&` across `*.controller.ts` to check for recurrence).

**Risk-gated `/code-review high` on a ~100-file, whole-app-touching diff is worth running even
though most of the diff is mechanical.** 9 parallel review agents found: 3 fields typed `@IsNumber()`
where the DB column is `int` (an ED triage queue's `acuityLevel`, a prescription's `durationDays`,
CSSD `quantity` — all capable of corrupting sort order or counts with a negative/decimal value
that would've otherwise slipped through); 2 DTOs that hand-rolled `page`/`limit` with `@IsNumber()`
instead of extending `PaginationQueryDto` (a non-integer `limit` reaches Postgres as a fractional
`LIMIT`/`OFFSET` and 500s); a radiology create-path missing the non-negative-price guard its own
update path already enforces; and — on DTOs written by hand, not by an agent — an empty-string
password bypassing the "generate a strong password when none is supplied" fallback in both
`accounts.service.ts` and `tenants.service.ts` (`input.password ?? generated` only catches
`null`/`undefined`, never `""`; fixed by adding `@IsNotEmpty()` alongside `@IsString()` on every
optional password field). The review also reached into already-shipped, unrelated code by scanning
the whole branch rather than just this diff's files — real findings there (a platform-billing
concurrency bug, a tenant-purge atomicity gap, an SVG-logo stored-XSS vector, unbounded branding
`displayName`, a `/branding` path-suffix collision suppressing a security warning) were triaged: the
branding/middleware ones were small and severity-appropriate to fix inline anyway (see below);
the platform-billing and tenant-purge ones were logged as new backlog items (2.19–2.21) rather than
folded into this task's diff, to keep 2.18 scoped to DTO validation.

**Fixed inline despite being outside 2.18's nominal scope, because they were small, high-severity,
and directly adjacent:** `platform-branding`'s `ALLOWED_LOGO_MIME_TYPES` no longer accepts
`image/svg+xml` — the service only checks the client-declared mimetype (never inspects content)
and writes that same value back as the served object's `Content-Type`, so an uploaded SVG was
stored XSS against anyone opening the presigned logo URL directly; `UpsertBrandingDto.displayName`
gained a `@MaxLength(200)` (unbounded `varchar` column, echoed on every login-page read); and
`tenant-context.middleware.ts`'s `EXPECTED_FALLBACK_PATH_SUFFIXES` `/branding` entry — a plain
`.endsWith()` suffix match — was silently also matching `PlatformBrandingController`'s *authenticated*
admin routes (`platform/tenants/:hospitalId/branding`), which would suppress the "tenant context
fallback to headers" security warning on a permission-gated write path if `AuthContextMiddleware`
ever failed to populate `req.authContext` there. Replaced with a regex requiring at most one path
segment before `/branding`, which matches the public route (`/branding` in tests with no global
prefix, `/api/branding` in production) but not the nested admin one — see the file's own comment for
the reasoning, since this exact bug class (a suffix match over-matching a same-named nested route)
can recur if a future feature's route also happens to end in one of these three suffixes.

## 54. Standard audit columns across entities: `AuditableEntity`/`SoftDeletableEntity` (2026-08-22)

User-requested mid-session (not a pre-existing backlog item): `createdAt`/`createdBy`/`updatedAt`/
`updatedBy`/`deletedAt`/`deletedBy` across 61 entities. Full design and 10 numbered implementation
lessons in `new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md`
(`claude-code-tasks.md` 2.27) — this section summarizes the load-bearing ones for future work
touching these entities.

**Two-tier base class, not one flat class.** `apps/api/src/database/auditable.entity.ts` exports
`AuditableEntity` (creation/modification tracking only) and `SoftDeletableEntity extends
AuditableEntity` (adds `deletedAt`/`deletedBy` via `@DeleteDateColumn`). Extend `SoftDeletableEntity`
for anything a normal delete action might touch (nearly everything in scope); reserve the bare
`AuditableEntity` for an entity that should never be soft-deletable. `createdBy`/`updatedBy`/
`deletedBy` are plain nullable `varchar` — **not `uuid`**, despite `accounts.id` being a real uuid in
production: `TenantContextService.getAccountId()` reads straight from the JWT `sub` claim with no
format check, and this codebase's own test suite signs tokens with human-readable `sub` values
(`'ops.alice'`, etc.), which a `uuid` column rejects outright on the first write any such test makes.

**`AuditColumnsSubscriber` (`apps/api/src/database/audit-columns.subscriber.ts`) populates all
three actor columns automatically — never set them in service code.** `beforeInsert`/`beforeUpdate`
mutate `event.entity` (TypeORM persists whatever the entity object holds by the time these fire, so
this works normally) and only fill a still-`null` field, never overwrite — a few entities
(`Invoice`, `JournalEntry`, `NursingTask`) predate this subscriber and resolve `createdBy` themselves
via their own `resolveActor()` helper; the subscriber is a no-op for those, not a conflict.
**`deletedBy` cannot be set this way.** `repository.softRemove()` runs a narrow, purpose-built
`softDelete()` query that sets *only* the `@DeleteDateColumn` — it never reads any other entity
property, subscriber-mutated or not, so a `beforeSoftRemove` hook mutating `event.entity.deletedBy`
compiles, looks right, and is silently discarded (confirmed by reading
`node_modules/typeorm/persistence/SubjectExecutor.js`'s `executeSoftRemoveOperations`). The
subscriber instead uses `afterSoftRemove`, issuing an explicit follow-up `UPDATE` via `event.manager`
(same transaction as the soft-remove) keyed on `event.metadata.primaryColumns` read off
`event.databaseEntity` (`event.entity` is optional/frequently absent on TypeORM's remove-family
events — `databaseEntity` is the field its own `RemoveEvent` type guarantees present). This was only
caught by a dedicated integration spec that asserted `deletedBy` specifically, not just `deletedAt`
— a superficial "did the soft-delete work" check would have missed it, since `deletedAt` genuinely
does get set correctly by TypeORM's own internal handling of `@DeleteDateColumn`.

**Only convert `repository.remove()` to `.softRemove()` where a real delete call site exists.**
Research (confirmed by code review across the whole diff) found the codebase already avoids hard
deletes on core records almost entirely — patient "delete" is an `isActive` flag, most in-scope
entities have no delete/remove method implemented at all. The three genuine exceptions converted:
`EncountersService.deletePrescription()`/`deleteDiagnosis()` and `VitalsService.void()` (despite the
name, this was a hard delete before the fix). Adding `deletedAt`/`deletedBy` columns to an entity
does not, by itself, change any existing behavior — `remove()` still hard-deletes even on a
`SoftDeletableEntity`; only a service explicitly calling `.softRemove()` gets the new behavior.

**A raw `manager.update(Entity, { id }, { field: value })` call silently bypasses the subscriber.**
`Patient.deactivate()` used exactly this pattern — found by code review, not by any test.
TypeORM's `UpdateEvent.entity` for a `.update()` call (as opposed to `.save()`) is the literal
partial-values object passed in (`{ isActive: false }`), not a real `Patient` instance, so
`AuditColumnsSubscriber`'s `instanceof AuditableEntity` guard fails and `updatedBy` never gets set
— while `updatedAt` *does* still get bumped, since TypeORM handles `@UpdateDateColumn` directly in
its own SQL generation, independent of subscribers entirely. The gap is easy to miss precisely
because the timestamp still looks right. Fix: load-then-`save()`, the same pattern already used
correctly everywhere else in this codebase (e.g. `MasterDataService.deactivateDepartment()`).

**Verify a migration's assumptions against the actual CREATE TABLE SQL, not the entity class.**
Two real gaps only surfaced by running the full test suite against the real migration (not just
`tsc --build`): (1) 6 tables (`roles`, `permissions`, `patient_addresses`, `patient_kins`, `beds`,
`departments`, `wards`, `department_catalog`, `packages`, `subscriptions`) were missing
`createdAt`/`updatedAt` entirely — the working assumption "these already exist everywhere" was
wrong, caught by `column "createdAt" of relation "roles" does not exist` on the RBAC-catalog seed
inside a fresh tenant-schema provision; (2) 3 tables (`invoices`, `journal_entries`,
`nursing_tasks`) already had `createdBy` as `uuid NOT NULL`, so the migration's uniform `ADD COLUMN
IF NOT EXISTS "createdBy" varchar` silently no-op'd on them, leaving the DB column `uuid` while the
entity now declared `varchar` — caught by code review, not the test suite (the fixture data
happened not to exercise a non-uuid actor on those specific 3 tables). Fixed with an explicit
`ALTER COLUMN "createdBy" TYPE varchar USING "createdBy"::varchar` for those 3, instead of `ADD
COLUMN IF NOT EXISTS`.

**Migration sort-key ordering, again (see §-level `migration-safety-check` skill / the
`CreatePatientTables0008` incident):** migrations 0009–0049 use a `2000000000NNN`-prefixed `name`
suffix — numerically *larger* than a natural `1000000000053` would be. Migrations 50–52 got away
with the smaller `1xxx` prefix because they only ever touched tables created within that same `1xxx`
range (`tenants`, and their own new tables). This migration (0053) is the first one that needs to
`ALTER` tables created by the `2xxx` group, so it uses `3000000000053`/`054` — sorting after
*everything* — rather than inheriting the `1xxx` convention by pattern-matching the two most recent
migrations without checking what they actually depend on.

**`PLATFORM_MIGRATIONS` need an explicit `nx run api:migrate` (and `TENANT_MIGRATIONS` backfills
need `nx run api:migrate-tenants`) against the dev/test database — neither auto-applies per test
run.** `TENANT_MIGRATIONS` get exercised automatically because every `setupTenantTestContext` call
provisions a brand-new tenant schema from scratch; `PLATFORM_MIGRATIONS` apply once to the single
shared public schema and nothing in the test harness re-runs them. A new platform-scoped migration
is invisible to the test suite until `migrate` is run explicitly once against that environment.

## 55. Tenant purge: atomic drop ordering + revenue-history survives purge (2026-08-22)

`claude-code-tasks.md` 2.20. `TenantsService.purgeTenant` (`apps/api/src/tenants/tenants.service.ts`)
previously removed the `tenants` registry row *before* `DROP SCHEMA`/`DROP ROLE`, outside a
transaction. A failure or hang in the schema drop left the registry row already gone —
`hospitalId` immediately reusable, and a subsequent `provisionTenant`'s `CREATE SCHEMA IF NOT
EXISTS` would silently succeed against the still-populated old schema, exposing the previous
tenant's PHI to the new tenant's admin.

**Fix: wrap all three drops in one transaction, DDL before the registry row.** `DROP SCHEMA` and
`DROP ROLE` both participate in Postgres's transactional DDL (rolled back on abort, same as any
other statement — they are *not* in Postgres's short list of statements that can't run inside a
transaction block, e.g. `CREATE DATABASE`/`CREATE INDEX CONCURRENTLY`/`VACUUM`). So
`this.dataSource.transaction(async (manager) => { DROP SCHEMA; DROP ROLE; manager.getRepository(Tenant).remove(tenant); })`
gives real atomicity: any failure at any step rolls back everything, including an already-run
`DROP SCHEMA`. The additional ordering (DDL drops first, registry-row removal last) is defense in
depth on top of that: even without the transaction wrapper, this order alone means a mid-purge
failure leaves the registry row — the thing that blocks `hospitalId` reuse — intact.

**Revenue history: drop the cascading FK, don't archive.** `subscriptions.tenantId REFERENCES
tenants("hospitalId") ON DELETE CASCADE` (migration 0051) meant every purge silently deleted the
platform's own billing/revenue history for that tenant. Migration `0055-drop-subscriptions-tenant-
fk-cascade.ts` drops that FK constraint entirely rather than switching it to `ON DELETE SET NULL`
or building a separate archive table — this matches the existing, deliberate precedent set by
`audit_records` (migration 0006), which was created with no FK to `tenants` at all specifically so
it survives a tenant purge. `tenantId` becomes a plain informational `varchar` post-purge, same as
`audit_records.recordId`/`changedByAccountId`. `subscription_invoices.subscriptionId` still
cascades from `subscriptions(id)`, which is fine — `subscriptions` rows themselves are no longer
deleted by a purge, so that cascade never fires.

**Known follow-on gap, not fixed here (see `claude-code-tasks.md` 2.28):** `provisionTenant` only
checks the live `tenants` table for an existing `hospitalId` — nothing stops a *purged* `hospitalId`
from being reused by a brand-new, unrelated tenant. Combined with the FK removal above, a reused
`hospitalId` would show the previous (purged) tenant's `subscriptions`/`subscription_invoices` rows
mixed into the new tenant's billing views (`listSubscriptions`/`listInvoices` both filter only by
`tenantId` string). This is a narrower, lower-severity version of the same "purged hospitalId is
too freely reusable" theme as `claude-code-tasks.md` 2.23 (purge + stale refresh token 500s) — worth
revisiting together with that item rather than each in isolation.

**Testing a real mid-transaction DDL failure, not just a validation short-circuit.** To prove the
transaction actually rolls back (not just that a `BadRequestException` fires before any DDL runs),
`tenants.service.integration-spec.ts`'s purge tests force a genuine `DROP ROLE` failure: `ALTER
TABLE public.<dummy> OWNER TO "tenant_<id>"` makes the tenant role own an object outside its own
schema, so Postgres refuses to drop it ("role cannot be dropped because some objects depend on
it") after `DROP SCHEMA` has already run earlier in the same transaction — exercising the actual
rollback path.

## 56. Billing-cycle switch resets the period only when the cycle actually changes (2026-08-23)

`claude-code-tasks.md` 2.21/2.22. `SubscriptionBillingService.subscribe()` reuses the tenant's
existing active `Subscription` row for both a same-terms re-subscribe and an actual plan/cycle
change — one code path, two different correct behaviors for `currentPeriodStart`/`currentPeriodEnd`.

**The bug:** the row's period was left untouched unconditionally. A same-cycle re-subscribe
correctly kept its period (intentional — re-confirming terms mid-period shouldn't reset the billing
clock). But an actual `billingCycle` switch (monthly→annual or the reverse) *also* kept the old
cycle's period while `pricePerCycle` jumped to the new rate — `issueInvoice()` then billed the full
new-cycle price against the stale period length, recurring every time that period rolled over
(2.22: a monthly→annual switch mid-period billed the full annual price every 30 days).

**The fix:** reset the period only when `existing.billingCycle !== billingCycle` (or there's no
existing row at all — first subscribe). Same-cycle resubmits are unaffected; a real cycle switch
starts a fresh period sized to the new cycle from the moment of the switch. General pattern for any
future "reuse or create" write like this one: when a single code path handles both "same terms,
different call" and "actually changed something," identify exactly *which* fields the changed-vs-
unchanged distinction affects, and gate only those fields on the comparison — don't assume "reuse
the row" implies "reuse every field unconditionally."

**Also fixed in the same pass (2.21, lower severity, same file):** `resolvePrice()` silently fell
back to monthly pricing for a `billingCycle` value the TypeScript type didn't actually guarantee at
runtime (only the DTO's `@IsIn(...)` enforced it — a future direct-service caller, e.g. a cron
auto-renew job, would have bypassed that). Now throws `BadRequestException` instead of silently
mispricing. `listInvoices(tenantId?: string)` accepted an omitted tenant and returned *every*
tenant's invoices — not exploitable today (the only caller always passes one), but a live
cross-tenant billing-data-exposure footgun for any future caller; `tenantId` is now required.

## 57. A narrower lock scope than a sibling method's read-modify-write footprint is a silent race (2026-08-23)

`claude-code-tasks.md` 2.19. `markInvoicePaid` took only an invoice-scoped advisory lock
(`platform_billing_invoice:${invoiceId}`), reasoning (in its own comment) that it "never contends"
with `subscribe`/`cancelSubscription`/`issueInvoice`, which take a tenant-scoped lock instead. That
reasoning covered the invoice row it directly modifies, but missed that `markInvoicePaid` *also*
reads, then unconditionally `.save()`s, the `Subscription` row (to advance the period on renewal) —
exactly the row the tenant-scoped lock exists to protect. A concurrent `cancelSubscription`
committing between that read and write got silently overwritten back to `'active'` by
`markInvoicePaid`'s stale in-memory copy.

**General pattern:** when a method takes a narrower lock than a sibling method's lock scope,
audit that method's *entire* read-modify-write footprint, not just the row named in the lock's key
— any TypeORM `.save()` on a fully-loaded entity is a full-column write of whatever was in memory
at load time, so a lock that doesn't cover every entity the method touches leaves a real race, no
matter how "obviously" invoice-scoped the operation looks from its name.

**Fix:** `markInvoicePaid` now acquires the tenant-scoped lock too (`invoice.tenantId`, taken after
the invoice lock, before touching the subscription), and re-reads the subscription only *after*
acquiring it — never the pre-lock snapshot. No deadlock risk: `markInvoicePaid` is the only method
that ever holds both locks at once, always in the same order (invoice lock, then tenant lock).

**Verifying a race fix actually closes the race, not just that a test passes:** before committing,
the new `2.19:` test (concurrent `cancelSubscription` + `markInvoicePaid`) was run 5x against the
pre-fix code (git-stashing the service change while keeping the test) — it failed 4/5 times,
confirming it reliably reproduces the bug rather than passing vacuously — then 5/5 against the fix.
A race test that has never been observed to fail against the bug it claims to catch hasn't proven
anything; deliberately reverting the fix and re-running is cheap insurance against a false-negative
regression test.

## 58. `provisionTenant` cleanup-on-failure + `refresh()` catches a purged tenant's dropped schema (2026-08-23)

`claude-code-tasks.md` 2.23. Two unrelated bugs sharing one root cause: `TenantsService.
provisionTenant` and `AuthService.refresh()` both assumed a registry row's existence (or its
absence/status) is the single source of truth for tenant state, when the tenant *schema* is the
real ground truth and can diverge from the registry row.

**`provisionTenant`: why a nested transaction wasn't possible.** The registry-row insert through
bootstrap-admin creation isn't one atomic DB transaction, and can't cleanly become one:
`tenant_roles`'s FK to `tenants("hospitalId")` requires the registry row to exist first (so it can't
be inserted before the row), and department-seed/bootstrap-admin creation both run in their *own*
tenant-schema transaction via `runInTenantSchema` (`SET LOCAL ROLE`/`search_path`, scoped to its own
`queryRunner`), which can't be nested inside the platform-schema transaction that would wrap the
registry-row insert. **Fix:** instead of atomicity, best-effort cleanup — wrap the whole block in a
try/catch, and on any failure delete the just-inserted registry row before rethrowing. This keeps
`hospitalId` immediately retryable without requiring archive+purge. The schema/role created earlier
in the flow are deliberately left behind on failure: `provisionTenantSchema`'s `CREATE SCHEMA IF NOT
EXISTS` plus TypeORM's inherently-idempotent migration runner (tracks applied migrations, skips
them on a second run) make re-running it on retry a safe no-op/resume, so there's nothing to clean
up there.

**`refresh()`: catch the schema failure, don't pre-check registry state.** The natural-looking fix —
`if (!tenant) return invalidToken` before touching the schema — is wrong: `getTenant()` returns
`null` for a purged tenant *and* for the platform tenant (by design) *and* for schema-only test
tenants with no registry row (this codebase's established fail-open convention for registry-gated
checks, shared with `AccountsService.createStaffAccount`'s role-membership check). A registry row's
absence can't distinguish "purged" from "never registered" — but the tenant schema's actual
existence can. So the fix instead wraps the schema-touching call itself
(`accountsService.getAccountWithRoles`, inside `tenantContext.run`) in a try/catch: a purged
tenant's dropped role/schema make `runInTenantSchema`'s `SET LOCAL ROLE` throw a real Postgres
error, which is now caught and translated to `{ invalidToken: true }`. A schema-only test tenant's
schema genuinely still exists, so the call still succeeds for it exactly as before — the fix adds
zero new rejection paths for the fail-open case it must not disturb.

**Verifying against the pre-fix code, not just that the new test passes:** both fixes were verified
by git-stashing the source change (keeping the new test) and confirming the test actually fails
against the unfixed code with the exact expected error (`ConflictException: Tenant ... already
exists` left behind for `provisionTenant`; `QueryFailedError: role "tenant_..." does not exist` for
`refresh()`) before restoring the fix and confirming it passes — same discipline as §57.

**Known sibling gap, not fixed here:** `AuthService.login()`/`changeInitialPassword()` have the
identical root-cause bug (schema access before any status check), but `login()`'s check is
deliberately deferred until *after* password verification to avoid leaking tenant state to a
wrong-password attempt — so the fix shape has to preserve that anti-enumeration property (treat the
caught failure as `invalidCredentials`, not a new outcome), not just copy `refresh()`'s pattern.
Logged separately as `claude-code-tasks.md` 2.32.

## 59. Full-suite flake triage: parallel-load contention vs. genuine test-isolation gaps (2026-08-23)

`claude-code-tasks.md` 3.1. The full backend suite (97 suites, each provisioning its own tenant
schema against one shared dev Postgres) was intermittently failing unrelated suites under full
parallel load — passing cleanly in isolation every time, the classic signature of resource
contention rather than a real bug.

**Fix: back off the parallelism, not the correctness.** `jest.config.cts`: `maxWorkers` 4→2 (fewer
concurrent full migration runs competing for the same DB), `testTimeout` 60s→120s (each suite's
`beforeAll` does a full schema+migration provision, comfortably over budget under load at the old
timeout). `data-source.ts`: `connectionTimeoutMillis` default 5s→15s, made env-tunable
(`DB_CONNECTION_TIMEOUT_MS`) like its siblings, since acquiring a pool connection under contention
was a documented but previously ignored possible failure mode. `tenants.service.integration-spec.
ts`/`auth.service.integration-spec.ts` also gained proactive `beforeAll` cleanup (not just
`afterAll`), tolerating drop failures — a prior run's leftover schema/role/registry row (from a
crashed or interrupted earlier run) no longer permanently blocks every subsequent run.

**Verifying a flake fix without a flake-free environment to test it in.** 3 consecutive full runs
were the actual verification (matching this task's own criterion), not a single green run — and
even then, "same failure set" is the honest bar, not literally zero: one run surfaced a one-off
`mvp-workflow.integration-spec.ts` 403 that didn't recur in the other two, plausibly attributable to
genuine external contention on the shared dev DB (this session, mid-investigation, discovered other
concurrent Claude Code sessions were also actively running against the same repo/DB — see the
`claude-code-tasks.md` 1.x section for what was in flight). None of the *originally-documented*
flaky suites (`master-data.controller`, `charge-capture`, `patients`, `cssd`, `admissions`,
`seed-rbac`, `metrics`, `master-data-permgate`) failed in any of the 3 runs — the actual target of
this task.

**A "flaky" failure can turn out to be a deterministic bug hiding behind persistent shared state.**
`packages.integration-spec.ts`'s `test_pkg_roles` test provisions a real tenant via
`tenantsService.provisionTenant()` but never cleans it up (`claude-code-tasks.md` 3.8) — this isn't
flaky at all, it's 100%-reproducible once the DB has been touched once, but it *looks* flaky in a
list of "sometimes this suite fails" if nobody's traced the exact cause yet. Worth distinguishing
before triaging a whole suite as "contention-flaky": check whether the specific failing assertion
is timing-shaped (a timeout, a race) or state-shaped (an already-exists conflict, a row that should
have been absent) — only the former is what parallel-load mitigation actually fixes.

## 60. Reviewing an already-merged commit batch: what a fast pass over new code tends to miss (2026-08-23)

A ~25-commit batch (`96d01bd..458b175`) landed this session covering 2.23/2.28/3.2-3.7/4.1 and
several `/code-review high`-driven fixes, faster than it could be reviewed inline. A dedicated
review pass afterward — two parallel finder agents plus a manual pass over `tenants.service.ts`/
`auth.service.ts` — surfaced 9 genuine findings across money-handling, deploy safety, and
observability, none caught by the tests that shipped alongside the original changes. What they had
in common:

**A guard added in 3 of 4 call sites, not audited against the full set.** `subscription-billing.
service.ts`'s `subscribe`/`cancelSubscription`/`issueInvoice` all gained an `assertValidHospitalTenant`
call in the same commit — `markInvoicePaid` didn't, despite mutating state (advancing the
subscription's period) just as much as the other three. The test written alongside the change
enumerated the guarded methods and happened to omit the same one. **Lesson: when adding a guard to
"every mutating method in this service," grep the class for every public method first and check
each one off, rather than trusting memory of which ones matter.**

**A "safety upgrade" changed observable behavior without anyone checking the new behavior against
the old.** `withAdvisoryLock`'s 2-arg form was intended to reduce hash-collision risk, but Postgres
treats `pg_advisory_xact_lock(bigint)` and `pg_advisory_xact_lock(int,int)` as two entirely separate
lock spaces — a hash collision was never a correctness risk (it just serializes two unrelated
resources, never causes a missing lock), but the "upgrade" introduced a real one: an old-code and
new-code instance running concurrently (a rolling deploy, exactly the scenario `Deployment-Guide.md`
describes) would silently stop mutually excluding each other. **Lesson: verify a refactor framed as
"strictly safer" against the actual documented semantics of what it's built on (here, Postgres's own
docs on advisory-lock argument forms), not just against the tests that happen to already exist —
tests written to prove the OLD behavior worked don't prove the NEW behavior is equivalent.**

**A tombstone/status-model change (`Tenant.status` gained `'purged'`) wasn't propagated to every
place that read the old two-value denylist.** `platform-billing`/`platform-branding` were updated in
the same batch to the new allowlist pattern (`assertValidHospitalTenant(hospitalId, ['active',
'suspended'], ...)`), which rejects `'purged'` by construction. `AuthService.checkTenantStatusGate`
(written earlier, not touched by the status-model change) kept its old `status === 'suspended' ||
status === 'archived'` denylist, which silently let `'purged'` through — not a live bug today (an
unrelated schema-access failure happens to also catch it for `refresh()`), but exactly the kind of
gap that becomes live the next time someone adds a new auth code path. **Lesson: when a status/enum
gains a new value, grep for every existing denylist-shaped check against the old values, not just
the call sites the current task happens to touch — an allowlist of "what's still OK" doesn't need
this audit; a denylist of "what's now blocked" always does.**

**A destructive/lifecycle operation (`purgeTenant`) was updated for its own primary table but not
for every platform-schema table representing that tenant's footprint.** The tombstone refactor
correctly handles `tenants`/`subscriptions`/`subscription_invoices`, but `tenant_branding` — a
separate platform-schema table with no FK relationship enforcing cleanup — was never touched, so a
purged tenant's display name and logo stayed servable via the unauthenticated `/branding` endpoint
indefinitely. **Lesson: for any operation whose job is "destroy/lock down everything associated with
X," grep for every table with a `tenantId`/`hospitalId` column, not just the ones the current task's
own tests exercise.**

**A "row cap" fix was verified against the wrong dimension of the actual risk.** 2.26's fix lowered
the PDF export's row limit 10000→500 and was marked done — but the actual DoS-shaped cost (pdfmake's
synchronous layout pass on an unbounded, attacker-controlled `correlationId`/`payload` string in an
`auto`-width cell) scales with *bytes per cell*, not row count; the row cap barely moved the ceiling.
**Lesson: when a finding describes a specific mechanism ("an unbroken multi-KB string in a
layout-engine cell"), verify the fix addresses that mechanism specifically — a plausible-sounding
adjacent fix (row count) can look complete without being complete.**

**A defensive fallback (`?.`/`?? default`) was added without confirming the branch it guards is
actually reachable — and the fallback's default silently reintroduced a bug the surrounding code was
written to prevent.** `audit.subscriber.ts` added `event.metadata?.primaryColumns?.map(...) ?? ['id']`
to "handle undefined primaryColumns," but TypeORM types `event.metadata` as non-optional and the real
integration spec proves it's always populated — the only thing actually exercising the fallback was
stale test doubles missing the field. The `['id']` default directly contradicted the comment three
lines below it explaining why the code resolves the *real* primary key instead of assuming `'id'`.
**Lesson: a defensive fallback for a condition the type system says can't happen is either dead code
or evidence of a bug being papered over — trace whether the condition is actually reachable before
keeping the fallback; if a test needs it, fix the test's fixture instead of loosening the production
code's contract.**

## 61. Closing the confirmed gaps: 2.32, 2.25, 3.8, and a fix introducing its own ordering bug (2026-08-23)

`claude-code-tasks.md` 2.32/2.25/3.8. Four independent fixes, one of them worth its own lesson.

**2.32 — `login()`/`changeInitialPassword()` raw-500 on a purged tenant.** The sibling gap 2.23
deliberately left open (`Development-Standards.md` §58): both call `findByUsernameWithRoles()`
before any status check, so a purged tenant's dropped schema/role throws a raw Postgres error.
Unlike `refresh()`, the caught failure folds into `invalidCredentials` (not a distinct outcome) for
`login()` specifically, because its status gate is deliberately placed *after* password
verification to avoid leaking tenant state to an unauthenticated caller — the fix has to preserve
that property, not just copy `refresh()`'s shape. Also added `Logger.warn` to all three catches
(this one, `changeInitialPassword`'s, and retroactively `refresh()`'s): a bare `catch {}` here was
originally silent, meaning a genuine infrastructure fault (DB pool exhaustion, an unrelated bug)
would read to monitoring as ordinary failed-login traffic with zero trace to diagnose from — four
independent review-agent passes converged on flagging this same gap unprompted.

**2.25 — three DTO-decorator gaps** (maternity dates as `@IsString()` instead of `@IsDateString()`,
inventory `displaySequence` as `@IsNumber()` instead of `@IsInt()`, insurance hardcoding its
`@IsIn()` list instead of reusing the exported constant). Mechanical, matching the established
pattern from the same DTO-decoration pass elsewhere in the codebase — the only actual judgment call
was where to put the HTTP-level regression tests, since maternity/inventory have no controller-level
integration spec of their own: added to `global-validation-pipe.integration-spec.ts`, the
established home for "does this decorator actually reject bad input end-to-end" checks that don't
have a natural per-module HTTP spec to live in.

**3.8 — a test that only cleaned up on success.** `try { ...; await dropProvisionedTenant(hospitalId); }`
with the cleanup call as the last line of the try block: any assertion failure anywhere above it
skipped cleanup entirely, leaving a real provisioned tenant behind that made every subsequent run
409 deterministically — not flaky, a genuine leftover. Fixed with `try { ... } finally { await
dropProvisionedTenant(hospitalId); }`, plus a pre-emptive `dropProvisionedTenant()` call *before*
provisioning (idempotent — `DROP SCHEMA/ROLE IF EXISTS`, `DELETE FROM tenants WHERE ...` — safe to
call speculatively), so the test also self-heals past a leftover from *any* prior failed run,
including ones from before this fix existed. **General pattern: a cleanup step written as "the last
line of the try block" isn't cleanup at all if anything above it can throw — it only ever runs on
the happy path. `finally` (or an `afterEach`) is the only shape that actually guarantees it.**

**The purgeTenant object-storage-removal ordering bug — introduced by 2.20/2.28's own review fix,
caught by reviewing that fix.** Earlier this session (§60), `purgeTenant` was extended to remove a
purged tenant's logo from object storage. The fix fetched the branding row and called
`objectStorage.removeObject()` *before* the DB transaction — reasoning (correctly) that object
storage isn't transactional with Postgres either way. But "not transactional with the DB" doesn't
mean "order doesn't matter relative to the DB": if the transaction failed and rolled back afterward
(e.g. `DROP SCHEMA` hitting a lingering lock), the DB was left `archived` with the branding row
still intact and pointing at a logo file that had already been deleted — a broken image with no
clean retry path, strictly worse than the bug being fixed. **Lesson: when a fix spans a
transactional store and a non-transactional side effect, the side effect must run *after* the
transaction commits, not before it starts — "not transactional with the DB" is a reason the ordering
matters, not a reason it's safe to ignore.** Fixed by moving the object-storage removal after the
transaction, and moving the branding-row lookup *inside* the transaction (closing an unrelated
stale-read window the same review caught). Four independent review-agent passes converged on this
same finding unprompted, the same pattern seen with the 2.32 logging gap above — when several
independently-primed reviewers converge on the identical finding without cross-talk, treat that as
a strong signal to actually fix it, not just note it.

## 62. Patient-portal Phase 1: a second account type reusing the staff auth stack (2026-08-23)

2.6's patient-portal item (`new/docs/superpowers/specs/2026-08-23-patient-portal-design.md`),
Phase 1 scope: patient login + read-only self-scoped records (appointments, invoices,
prescriptions, lab/radiology results). Booking, payment, and messaging are deferred — payment
specifically has zero existing gateway integration in this codebase and needs a vendor decision
before any design work, not just an engineering slice.

**`Account.accountType: 'staff' | 'patient'` existed as dead code before this** — declared on the
entity, hardcoded to `'staff'` in every write path, never read anywhere. Activating it needed: a
`patientId uuid nullable` column + partial unique index (`WHERE "patientId" IS NOT NULL`, so at
most one portal account per patient) on `accounts`; `AccountsService.createPatientAccount()`
mirroring `createStaffAccount()`'s generated-password/`needsPasswordUpdate: true` onboarding
exactly, but with no role assignment at all — patient accounts don't enter the staff RBAC
catalog.

**Auth is reused wholesale, not forked.** `AuthService.login()`/`refresh()`/
`changeInitialPassword()` are unchanged in control flow; only `buildAccessPayload()` gained
`accountType`/`patientId` claims, threaded from the `Account` row. A patient account naturally
gets `permissions: []` (`AccountsService.getPermissionNamesForRoles([])` short-circuits, and
`PackagesService.filterPermissions` is a no-op filter over an empty array) — no explicit "patients
get no permissions" branch was needed anywhere.

**A second, orthogonal guard, not an extension of `PermissionGuard`.** `patients.manage`-style
RBAC permissions model staff job functions; a patient isn't a weaker staff role, it's a different
kind of caller entirely. `PatientAuthGuard` (`libs/auth-guards`) checks
`request.authContext?.accountType === 'patient'` and rejects everything else, gating a whole
separate `/patient-portal/*` route namespace — inventing a fake `patients.self-service` permission
just to reuse `PermissionGuard` would have polluted the RBAC catalog with a concept that doesn't
belong there.

**Patient-scoping follows the same "context, not a query param" shape this codebase already uses
for tenant scoping.** `RequestContextStore` (`@hospital/tenant-context`) gained `patientId?:
string`, populated in `TenantContextMiddleware` *only* from `req.authContext.patientId` — deliberately
no `x-*` header fallback, unlike `tenantId`/`accountId`, since patientId has no legitimate
unauthenticated-route meaning the way login's tenant resolution does. Every
`PatientPortalService` method reads `tenantContext.getPatientId()` internally
(`requirePatientId()`) rather than accepting a `patientId` parameter — there is nowhere in the
service a caller could pass a different patient's id even if a controller bug tried to forward
one.

**Lab/radiology results have no direct `patientId`** — `LabRequisition`/`RadiologyRequisition`
only carry `orderItemId`, so the patient-facing read model joins `Order (patientId) → OrderItem →
requisition` in application code (three sequential `find({where: {..., In(ids)}})` calls, not a
raw-SQL join — small enough result sets per patient that this is simpler to read than a
query-builder join across un-related entities). Only `status: 'Verified'` requisitions are
included: an in-progress or just-sampled result hasn't been clinically reviewed, and the patient
seeing it before a clinician verifies it would bypass that review — this is a product-safety
filter, not just a data-completeness one.

**Migration sort-key trap recurred, same shape as §53's.** `accounts` was created by a *legacy*
migration (`0002`, `name` suffix `2000000000001` — TypeORM sorts migrations by the last 13
characters of `name`, not array position or filename, per the `migration-safety-check` skill and
the `CreatePatientTables0008` incident it documents). A migration adding a column to `accounts`
therefore needs a `3xxx`-prefixed sort key like §53's `AddAuditColumnsToTenantTables`, not the
`1xxx` scheme migrations 50/52/56 (all `PLATFORM_MIGRATIONS`, altering `tenants` in `public` —
never sharing a sort-order collision with legacy tenant-schema migrations) got away with. Caught
immediately by running the new migration's owning test file in isolation (`relation "accounts"
does not exist`) before it ever reached a shared or CI database — **any new
`TENANT_MIGRATIONS` entry altering a table from a legacy (pre-0050) migration must audit its sort
key against that migration's actual `name` field, not assume `10000000000NN` is always safe.**

**Invite-based onboarding, not self-registration.** `PatientsService.createPortalInvite()` is
staff-initiated (new `patients.portal-invite` permission, seeded to Super Admin/Hospital
Admin/Receptionist — the desk roles, not Doctor/Nurse) and anchors the new account to an
*existing* `Patient.id` staff already verified belongs to that person. Self-registration was
explicitly rejected for Phase 1: nothing in an open sign-up flow proves the caller is actually the
patient they claim to be, and getting that wrong is a PHI-exposure bug, not a UX gap to fix later.

## 63. Automatic ledger posting from Billing (2026-08-24)

2.8's item: billing events (payments, deposits, returns, charge-capture revenue) now post
balanced, immediately-`Posted` journal entries automatically — the accounting module previously
only supported manual `POST /accounting/journals`.

**Recognition timing — the deliberate choice.** Revenue is recognized at charge-capture (when
`InvoicesService.captureChargeForOrderItem` appends an invoice line), not at payment. A payment
only settles what's already owed. This needed a **Patient Accounts Receivable** asset account as
the pivot, not explicitly named in the original ask but structurally required for the two events
to net out: charge-capture debits AR / credits Revenue; payment debits Cash-or-Bank (or, for a
Deposit-sourced payment, debits Deposits Payable) / credits AR. A simpler "recognize revenue at
payment" model was considered and rejected — it would misstate revenue for any invoice that's
partially paid or never paid at all, which is common (deposits, insurance, partial settlements).

**Chart-of-accounts seed, referenced by fixed id, not by code.** Migration `0059` seeds five
accounts with hardcoded UUIDs (`apps/api/src/accounting/ledger-account-codes.ts` documents the
mapping): Patient AR (`1000`), Cash and Bank (`1010`, covers Cash/Card/UPI/Cheque — no per-mode
sub-accounts), Patient Deposits Payable (`2000`), Patient Service Revenue (`4000`), Sales Returns
(`4900`, a contra-Income account carrying debit-normal balances). Billing code resolves accounts by
these fixed ids, never by querying `accountCode` — `ledger_accounts.accountCode` has no DB-level
uniqueness constraint (pre-existing gap, unchanged by this work), so a code lookup could silently
resolve the wrong row if an admin later creates a duplicate-coded account via the manual API; a
primary-key lookup can't.

**Idempotency: `(sourceType, sourceId)` on `journal_entries`, not a naive "already posted"
boolean.** Migration `0058` adds nullable `sourceType`/`sourceId` columns plus a partial unique
index (`WHERE "sourceType" IS NOT NULL`). `AccountingService.postAutoJournal(manager, input)` looks
up an existing journal by that pair first. If found with **matching** lines (same accounts, same
debit/credit amounts), it's a safe retry — returned unchanged, nothing duplicated. If found with
**different** lines, the source key was reused for a genuinely different event and this is a
conflict, not a retry — it throws `ConflictException` rather than silently dropping the second
event. This distinction matters concretely for `DepositsService.refund`: `Deposit` has no
per-refund identity (only one `refundedBy`/`refundedAt` pair despite the method allowing repeated
partial refunds), so a second refund's journal is keyed on the same deposit id as the first. A
same-amount second refund would incorrectly no-op under a naive "exists → skip" idempotency check;
comparing lines makes a same-amount collision the only case that (documented, accepted) silently
no-ops, while every different-amount second refund fails loud instead of silently mis-booking.
Manual journals (`createJournal`/`postJournal`, unchanged) leave both columns null and are
unaffected by any of this.

**Hook points and the fail-loud/best-effort asymmetry (human ruling).** `postAutoJournal` runs on
the **caller's** `EntityManager` — no transaction of its own — so it commits atomically with
whatever billing write triggered it, mirroring `captureChargeForOrderItem`'s existing
manager-passing pattern (§27). It skips `Draft` entirely: auto-posted journals are created directly
as `Posted`, since there's no human review step for system-generated entries (corrections are new
entries, per the existing no-reversal convention). Two different failure-handling policies apply
depending on the hook:
- **Fail loud** (`InvoicesService.recordPayment`/`createReturn`, `DepositsService.create`/`refund`):
  no try/catch. An unbalanced input or a missing/inactive mapped account (an accounting
  configuration bug — `postAutoJournal` checks account existence/`isActive` itself, since
  `journal_lines.accountId` has no FK constraint) throws and aborts the whole billing transaction.
  Money-under-booking must never happen silently.
- **Best-effort** (`captureChargeForOrderItem`'s revenue posting only): wrapped in its own
  try/catch, logs and swallows, matching `ChargeCaptureSubscriber`'s existing "never roll back a
  Lab/Radiology/Pharmacy completion" rule (§27) — this runs inside that same clinical-completion
  transaction. Known limitation, same shape as the pre-existing "no re-run endpoint for a failed
  [pricing] capture": if revenue posting fails, the invoice item still exists, so a later
  `reRunChargeCapture` retry short-circuits on `already-charged` and never retries the posting;
  recovery is manual.

**Explicit out-of-scope for this iteration** (not silently skipped — documented): manually-created
invoice lines (via `InvoicesService.create`, not charge-capture) are never auto-posted, so a
manually-invoiced-and-paid invoice will show Cash/Bank and Patient AR movement but no matching
revenue entry; GST (CGST/SGST) is not split into a separate payable account, revenue posts at the
full line total; and, per the idempotency section above, a second different-amount refund against
the same deposit fails loud rather than posting, since `Deposit` has no per-refund identity to key
on.

## 64. Per-tenant branding: login-page copy fields (2026-08-25)

Extends §51's white-label config with four more nullable `tenant_branding` columns — `tagline`,
`description`, `footerText`, `supportText` — so a hospital's login page copy (not just its name,
color, and logo) can be overridden. Migration `0060` (platform-schema `ALTER TABLE`, no backfill
needed — nullable columns on a table only ever migrated once via `migrate.ts`, never replayed
per-tenant). Same trust model as every other branding field: Super-Admin-only write
(`system-admin.tenants.manage`), public unauthenticated read via `GET /branding`, unconfigured
means "show the default Vaidya copy."

**Validation and clearing semantics generalized, not duplicated per field.**
`PlatformBrandingService.upsertBranding` used to hand-check `displayName` alone for "blank string
rejected, `null` clears it, `undefined` leaves unchanged"; a `BLANK_CHECKED_TEXT_FIELDS` tuple now
drives both the validation loop and the assignment loop across all five text fields (`displayName`
plus the four new ones), keyed by DTO/entity property name shared between them. `primaryColor`
stays hand-written since its validation (hex-format regex) doesn't fit the same shape. Adding a
sixth text field with the same semantics is a one-line addition to the tuple, not a new
if-block pair.

**Frontend fallback lives in the template, not the service.** `BrandingService` exposes the four
new fields as plain signals (`tagline`/`description`/`footerText`/`supportText`, default `null`,
same pattern as `displayName`) with no fallback baked in — `login.html` does
`branding.tagline() ?? 'Hospital operations, one screen at a time.'` at each of the four call
sites, matching how `displayName ?? 'Vaidya'` already worked. Kept the literal default copy
in the template (not a shared constant) since each of the four strings is only read once, in
exactly one place — the existing `displayName ?? 'Vaidya'` sites already establish this as the
convention here, not an exception to it. `footerText` composes as *trailing* text after the
existing `© {year}` prefix (falling back through `footerText ?? displayName ?? 'Vaidya'`),
not a full-line override — a tenant customizing the footer still gets a correctly-dated
copyright line rather than needing to embed the year in their own copy.

**Not built:** hospital-admin self-service editing (Super Admin remains the sole writer, per
§51's original design note that this is "a tenant-registry-adjacent setting, not a
hospital-editable preference" — confirmed unchanged for this iteration); localization/i18n of
this copy; per-field character-count UI (server-side `@MaxLength` is enforced but the tenant-detail
form doesn't surface a live counter).

## 65. Fixed-assets depreciation accrual (2026-08-25)

`pending-tasks.md`'s Fixed Asset entry / `claude-code-tasks.md` 2.9's smallest-valuable-slice:
`FixedAssetsService.getAssetValuation`'s stateless read-time straight-line calculation (§33's
`computeStraightLineValuation`) now has a persisted counterpart —
`runDepreciationAccrual(month, year)` writes one `asset_depreciation_entries` row per eligible
asset for that period, mirroring Payroll's `runMonthlyPayroll` shape (§ Payroll module):
validate month/year, resolve the actor from tenant context, iterate eligible rows, skip what
already has an entry, persist the rest. The two coexist rather than one replacing the other — the
valuation endpoint still answers "what is this asset worth right now," the new endpoints answer
"what did we book in period X," which an accounting close needs a stable, non-recalculating
number for.

**Incremental-against-most-recent-entry, not assumed-monthly.** A naive implementation would
charge `annualDepreciation / 12` every run and call it done, but that silently assumes accrual
runs happen exactly once a month with no gaps. Instead each run computes
`computeStraightLineValuation(asset, periodEnd)` — the *cumulative* accumulated depreciation as
of the end of the requested period — and charges only the delta against whatever the asset's most
recent prior entry (by `periodYear`/`periodMonth` DESC, not assumed to be the immediately
preceding calendar month) already accumulated, defaulting to 0 for an asset's first-ever entry.
A skipped month, an asset added mid-year, or an admin running two periods back-to-back in one
sitting all charge the mathematically correct incremental amount this way, with no special-casing
needed for any of them — `periodEnd = new Date(year, month, 1)` (JS's 0-indexed month arithmetic
happens to land exactly on "first of the month *after* the 1-12 `month` argument," reusing
`computeStraightLineValuation`'s existing `monthsInService` math instead of duplicating it).

**Eligibility filter, and why `Retired` is excluded but `Under Repair` isn't.** Raw SQL (matching
Payroll's own `SELECT ... WHERE "isActive" = true` pattern) filters to `isActive = true`,
`condition != 'Retired'`, and `usefulLifeYears IS NOT NULL` before the per-asset loop runs — an
asset with no useful life set already accrues nothing under the read-time formula, so excluding it
here is just avoiding a wasted no-op entry, not a behavior change. `Retired` is excluded because a
retired asset's depreciable life is considered over; `Under Repair` deliberately still accrues —
it's a temporarily-out-of-service asset the hospital still owns and is still consuming useful life,
not a disposed one.

**Idempotency is the same "an entry already exists for this key, skip it" shape as Payroll**, not
the compare-and-conflict shape §64 (billing auto-posting) uses — a re-run for a period an asset
already has an entry for silently skips that asset (not an error, not a `ConflictException`) and
continues the rest of the batch, matching `runMonthlyPayroll`'s per-employee skip. This is
deliberately looser than §64's journal-posting idempotency: a depreciation entry is a computed
snapshot with no independent "did the inputs change" signal like a journal's debit/credit lines
carry, so there's nothing meaningful to compare against beyond "does a row already exist."

**Not built (scoped out, confirmed with the human):** disposal/write-off, asset transfers between
departments, maintenance/AMC tracking, and a frontend page — none of `pending-tasks.md`'s Fixed
Asset "Not done" list beyond the accrual job itself was in scope for this iteration; each remains
a distinct future item.

## 66. Admissions P2 batch: race backstops and post-review lock, mirroring already-fixed P1 shapes (2026-08-26)

Four P2s from `code-review-findings-2026-08-25.md`'s admissions section, picked as a single batch
(none touches money and none changes the tenant-isolation/actor-derivation shape §25 and the §57/
§58 admissions P1 fixes already established) — each one reuses a pattern this file already
documents rather than inventing a new one:

**`transfer()`'s bed race now maps to 409 the same way `admit()`'s does.** `admit()` already
catches a `UQ_admissions_active_bed`/`23505` violation on its own insert and maps it to
`ConflictException` (§ the 2026-08-25 admissions P1 fix); `transfer()` did the identical
check-then-save dance but had no catch block, so the identical race surfaced as a raw 500. Added
the same catch, no new constraint needed — `UQ_admissions_active_bed` already covers both
`INSERT` (admit) and `UPDATE` (transfer) paths since it's a partial unique index on
`(bedId) WHERE status = 'Admitted'`, not an insert-only trigger.

**`admit()`'s triage-patient check was incomplete, not missing.** It already verified the triage
entry was linked to *some* patient (`triageEntry.patientId` non-null); it just never compared that
patient against `input.patientId`. One extra `!==` check, same `BadRequestException` shape as the
sibling check three lines above it.

**Discharge-summary review lock: `reviewedAt` as the guard column, checked at the top of both
mutators.** `updateDischargeSummary` and `reviewDischargeSummary` both now reject with
`ConflictException` when `summary.reviewedAt` is already set, checked before any field mutation —
this closes both "edit content after sign-off" and "review a second time" in one guard, since both
paths write through the same `reviewedAt` column. `updateDischargeSummary`'s own inline
`reviewedBy`/`reviewedAt`-setting branch (a second, less-obvious way to review a summary) is left
in place rather than removed, since it's now covered by the same guard.

**`discharge_summaries` gets the same select-then-insert race backstop as `admissions`.**
`createDischargeSummary`'s "does a summary already exist for this admission" check was a bare
`findOne` with no supporting constraint — identical shape to the bed/patient races above it.
Added `UQ_discharge_summaries_admission` (migration 0065, a plain unique index — unlike
`UQ_admissions_active_bed`/`UQ_admissions_active_patient` this one isn't partial, since a
discharge summary is 1:1 with an admission for its whole lifetime, not scoped to a transient
"currently admitted" state). No catch-and-remap added to `createDischargeSummary` itself: unlike
the transfer/admit races, a losing concurrent insert here is not a legitimate live status a caller
would retry into — it's a true duplicate-write and should not be silently swallowed as anything
other than the raw constraint error surfacing (this diverges from the transfer/admit precedent
deliberately, not by oversight).

**Test rigor:** each fix got both a happy-path/synchronous-check test and, where the finding was
specifically about a *race* (transfer bed conflict, discharge-summary duplicate), a deterministic
race-simulation test using the same `Promise.allSettled` — direct-repository-insert pattern already
established for `UQ_admissions_active_patient` (§ the 2026-08-25 admissions P1 spec) rather than
relying on true concurrency, which is flaky in this test environment.

## 67. Billing P2 batch: deposit-refund idempotency, a charge-capture row lock, and the
    billing.read/billing.manage split (2026-08-26)

Five P2s from `code-review-findings-2026-08-25.md`'s billing section, picked as a single batch. The
remaining two (GST-split reversal on returns; charge capture's hardcoded 0% tax) are left open —
both are already documented, deliberately deferred, larger design gaps (§63), not a P2-batch-sized
fix.

**Deposit-refund idempotency: check the ledger *before* mutating balance, not after.**
`DepositsService.refund` previously decremented `deposit.balance` unconditionally, then called
`AccountingService.postAutoJournal` keyed on `(sourceType: 'DepositRefund', sourceId: depositId)`.
A same-amount retry passed that journal's own idempotency check (§63: existing lines match → safe
no-op), but the balance had already moved a second time before that check ever ran — real money
moved twice while the ledger only ever showed it once. `refund()` now queries `JournalEntry`/
`JournalLine` for an existing `DepositRefund` journal on this deposit *before* touching balance,
mirroring `postAutoJournal`'s own dedup logic instead of relying on it after the fact: a
same-amount match returns the deposit unchanged (true no-op, no new journal); a different-amount
match throws `ConflictException` immediately, before any mutation (previously this same outcome
only happened indirectly, via the journal call's own conflict deep in the transaction, after
balance was already touched and then rolled back by the transaction failure). No new
migration/entity — this reuses the existing partial unique index backing
`journal_entries(sourceType, sourceId)` from migration `0058`. Billing importing
`JournalEntry`/`JournalLine` from `../accounting/entities/...` is not a new edge: `InvoicesService`
already imports `AccountingService`/`LEDGER_ACCOUNT_IDS` from the same module, and `accounting` has
no domain tag in `eslint.config.mjs`'s module-boundary rules (a separate, already-tracked P2, not
introduced here).

**Charge capture's invoice read is now row-locked, like every sibling mutator.**
`captureChargeForOrderItem` read the open invoice via a plain `findOne` (no lock), then later wrote
the *entire* invoice row back via `save()` — including whatever `paidAmount` was in memory at that
unlocked read. A concurrent `recordPayment`/`createReturn`/`cancel` (all of which already take
`lock: { mode: 'pessimistic_write' }` on the same invoice) committing between that read and
capture's later `save()` had its `paidAmount` update silently overwritten by capture's stale
in-memory copy — a real payment recorded and journaled, then invisibly reverted. Added the same
`pessimistic_write` lock to capture's open-invoice lookup. The existing per-patient advisory lock
(`withAdvisoryLock`) is unrelated and stays: it serializes concurrent *charge captures* for the same
patient (the open-invoice-*creation* race, before any row exists to lock), not access to an
invoice that already exists.

This is the one test in this batch that uses true concurrency rather than the deterministic
`Promise.allSettled` pattern established in §66 — deliberately: that pattern works for a *unique
constraint* race (the DB rejects a losing concurrent insert regardless of timing), but this bug is
about a **row lock** blocking a stale read, which only manifests under actual overlapping
transactions. `charge-capture.integration-spec.ts`'s new test holds `captureChargeForOrderItem`'s
transaction open (via a plain `setTimeout` after the call, inside the same `runInTenantSchema`
callback) well past its internal commit point, then asserts a concurrent `recordPayment` against
the same invoice cannot resolve until that hold releases — Postgres's row-level locking guarantees
this deterministically once genuinely concurrent transactions are opened, unlike an
application-level timing race, so it isn't the flaky kind of concurrency test §66 avoids.

**`billing.read` / `billing.manage` split, mirroring `accounting.read`/`accounting.manage`
exactly.** `billing.manage` gated every billing endpoint, so front desk could issue refunds and
Auditor/Compliance had no way to view invoices at all. Added `billing.read`; `InvoicesController`'s
and `DepositsController`'s GET handlers now require it instead of `billing.manage` (writes
unchanged). Every role that held `billing.manage` (Super Admin, Hospital Admin, Receptionist/Front
Desk, Billing/Accounts Staff) also gets `billing.read` granted alongside it — no role lost write
access. Additionally, `billing.read` (read-only, no `.manage`) now goes to Auditor/Compliance,
closing the "auditors can't view invoices" half of the finding. Same caveat as every other
seed-only RBAC change so far: the seed is create-only (`ON CONFLICT DO NOTHING`, itself a tracked
P2), so this permission reaches an already-provisioned tenant only via that pipeline's existing
re-seed mechanism.

## 68. Patients P2/P3 batch: PATCH address/kin replacement, deactivation cascade, and an
    advisory-lock alternative to a unique constraint (2026-08-26)

Four items from the patients section of `code-review-findings-2026-08-25.md`.

**PATCH now replaces `addresses`/`kins` instead of silently dropping them.** `update()` only ever
copied 11 scalar fields onto the entity — a client sending `addresses`/`kins` in the PATCH body got
a 200 OK with the record unchanged. Fixed with full-replace semantics matching `create()`: when the
DTO includes `addresses` or `kins`, the existing rows for that patient are deleted and the DTO's
array is inserted in their place, inside the same transaction as the scalar-field update. Cascade
alone (`cascade: true` on the `Patient.addresses`/`kins` OneToMany) isn't enough here — TypeORM only
inserts/updates the array it's given, it doesn't drop rows missing from it without
`orphanedRowAction: 'delete'` — so the delete is explicit.

**Deactivating a patient now revokes their portal login too.** `deactivate()` only ever flipped
`Patient.isActive`; a deactivated patient's portal account stayed fully active, and
`PatientPortalService.getMe()` didn't check `isActive` either, so an already-issued session could
keep reading the deactivated patient's own profile. Added `AccountsService.deactivatePatientAccount
(patientId)` — a no-op if the patient never had a portal account (portal access is opt-in via
`createPatientAccount`) — called from `PatientsService.deactivate()` after the Patient row is
saved. `getMe()` now also filters `where: { id: patientId, isActive: true }`, closing the
already-issued-session gap for that one endpoint. The account-level fix is what actually matters
for future logins (`AuthService.login` already rejects `!account.isActive`); the `getMe()` filter
only helps for a session issued before deactivation, and only for that one portal endpoint — the
patient-portal module's own broader "no `isActive` filter anywhere" finding (its `listAppointments`/
`listInvoices`/`listPrescriptions`/`listResults` siblings) is tracked separately and intentionally
left for when that module comes up.

**Duplicate-patient check: an advisory lock, not a unique constraint, because duplicates are a
deliberate feature here.** Every other P1/P2 fix in this file that closed a "select-then-insert"
race did it with a backing unique index (`UQ_admissions_active_patient`, `UQ_fraction_entries_
invoice_doctor`, `UQ_discharge_summaries_admission`, ...). That pattern doesn't apply to patients:
`create()`'s `allowDuplicate` flag is a supported, deliberate override for legitimate same-identity
records (twins, a patient re-registered under a slightly different spelling, etc.), so uniqueness on
`(phoneNumber)` or `(firstName, lastName, dateOfBirth)` can't be enforced unconditionally at the DB
level without breaking that override. Instead, `create()` now takes a `pg_advisory_xact_lock` (the
existing `withAdvisoryLock` util, already used by platform-billing) keyed on the same identity
signature `findDuplicates()` branches on, inside the same transaction as the check-and-insert. Two
concurrent requests for the same identity now serialize on the lock instead of both observing "no
duplicate" and both inserting — the DTO-driven `allowDuplicate: true` path is untouched since it
never takes the lock. This is the pattern to reach for whenever a select-then-insert race can't be
closed with a unique constraint because the "duplicate" it's guarding against is sometimes valid.

**`check-duplicates` validated via a real DTO.** The endpoint took an inline object-literal type as
its `@Body()`, which `ValidationPipe` can't validate (no class, no decorators) — any shape reached
the service. Added `CheckDuplicatesDto` and used it on both the controller and the service method
signature.

## 69. Appointments P2/P3 batch: doctor-slot unique constraint, cancel idempotency, and a
    protected-config edit Claude cannot make (2026-08-26)

Five items from the appointments section of `code-review-findings-2026-08-25.md`; one deferred as
a feature request, one left with a known lint gap.

**Doctor double-booking closed with the same unique-index pattern as admissions.** `create()`/
`update()`'s conflict checks were select-then-insert only. Added `UQ_appointments_active_doctor_slot`
(migration 0066): a partial unique index on `(doctorId, appointmentDate, appointmentTime) WHERE
status = 'Scheduled' AND "doctorId" IS NOT NULL` — the `doctorId IS NOT NULL` guard matters because
appointments may legitimately omit a doctor (department-only bookings), and Postgres treats NULLs
as distinct in a unique index regardless, so the predicate is about intent clarity, not correctness.
Both `create()` and `update()` now catch a `23505` on that constraint and map it to a 409, same
shape as the admissions `UQ_admissions_active_bed`/`UQ_admissions_active_patient` handlers.

**`cancel()` is now idempotent, and its body is a real DTO.** Cancelling an already-cancelled
appointment silently re-saved it instead of rejecting; added a status guard (409), matching
`update()`'s existing cancelled-appointment guard. Replaced the controller's inline
`{ cancelledRemarks: string }` body type — invisible to `ValidationPipe`, since it has no class or
decorators — with `CancelAppointmentDto`.

**Untested business rules: added direct `create()`-path coverage.** The slot-conflict and
department-capacity rules were only exercised via the `update()`/reschedule path (added alongside
the appointments P1 fix); `create()`, where both rules originate, had no direct test. Added one test
per rule against `create()`, plus a `cancel()`-idempotency test.

**Doctor-availability's hardcoded 16-slot constant: deferred, not faked.** A real fix means modeling
actual doctor working hours/shifts — nothing like that exists anywhere in this codebase today
(`doctorId` is a bare UUID with no profile/schedule entity behind it). That's a net-new feature, not
a P2-batch-sized patch, so it was captured as `new-features.md` #18 (Platform Features Still Needed)
instead of stubbed.

**`patientId` existence check: correct fix, blocked config edit.** `create()`/`update()` now 404 on
a `patientId` that doesn't resolve to a real patient — but this needs a `domain:appointments` →
`domain:patients` policy in `eslint.config.mjs`'s module-boundary rules (mirroring the existing
admissions/billing/orders → patients edges), and this repo's `guard-config.sh` hook unconditionally
blocks Claude's `Edit`/`Write`/`MultiEdit` on that file — its "use explicit instruction" message
isn't a real override path; nothing in the prompt satisfies it. The code fix is correct and tested;
`nx lint` (not part of CI) will flag the new cross-domain import until a human adds that one policy
block by hand. Worth knowing for any future cross-domain import this pass adds: **if the target
domain isn't already a sanctioned dependency, budget for asking the user to make that one-line
`eslint.config.mjs` edit themselves** rather than assuming an approved plan/AskUserQuestion answer
will satisfy the hook.

## 70. Clinical/encounters P2/P3 batch: note sign-off lock, patient-existence check,
    prescription discontinue/complete, pagination (2026-08-26)

Four items from the clinical/encounters section of `code-review-findings-2026-08-25.md`.

**Signed notes are now locked, using the discharge-summary pattern.** `updateNote()` was a plain
`Object.assign` with no status awareness — a signed note stayed fully editable forever. Added the
same guard shape as `AdmissionsService.updateDischargeSummary`'s `reviewedAt` lock: `updateNote()`
now rejects with 409 once `note.status === 'Signed'`. The transition into `'Signed'` itself still
goes through this same method and isn't blocked — the guard checks the status *before* applying the
update, so a Draft note being signed (status still `'Draft'` at that point) sails through; only a
second edit after signing hits the lock.

**Patient-existence check, and the same protected-config wall as appointments.** `createNote`/
`createDiagnosis`/`createPrescription` now 404 on a `patientId` that doesn't resolve to a real
patient — the same `assertPatientExists` shape (new private helper, one per-create call). This
needed a `domain:clinical-encounters` → `domain:patients` boundary policy that Claude could not add
itself (see §69's note on `guard-config.sh`); the code fix is correct and tested, `nx lint` will
flag it until a human adds that one block.

**Prescription discontinue/complete: a status machine, not a free-text field.** `Prescription.status`
could never change after creation. Added `discontinuePrescription`/`completePrescription`, both
routed through one private `transitionPrescription(id, nextStatus)` that only allows the transition
from `'Active'` (409 otherwise). New endpoints:
`POST /encounters/prescriptions/:id/discontinue` and `.../complete`. This closes only the
status-transition half of the finding — the other half ("nothing for Nursing's MAR to reference")
is nursing's own separate, still-open finding; a real prescription↔MAR link is that module's fix,
not this one's.

**Per-patient reads paginated.** `getNotesByPatient`/`getDiagnosesByPatient`/
`getPrescriptionsByPatient` now go through `@hospital/pagination`'s `paginate()` +
`PaginationQueryDto`, converting `find()` calls to `createQueryBuilder` + `paginate(qb, query)` —
identical shape to the nursing P1 pagination fix and `PatientsService.findAll`. Controllers accept
`page`/`limit` as `@Query()`.

## 71. Clinical/triage P2/P3 batch: linkPatient guards, update() patientId removal,
    the audit-columns gap migration 0053 missed (2026-08-26)

Four items from the clinical/triage section of `code-review-findings-2026-08-25.md`.

**`linkPatient` gained the three checks its name implied it already had.** No existence check, no
re-link guard, no closed-entry guard — a bad `patientId` (typo, wrong patient) would silently
propagate into `AdmissionsService.admit`, which trusts `TriageEntry.patientId` once set. Now 404s on
a `patientId` that doesn't resolve to a real patient, and 409s both on an already-linked entry (no
silent overwrite to a different patient) and on a closed entry (Discharged/Admitted/Deceased).

**`update()` can no longer touch `patientId` at all — architecturally, not just by convention.**
Removed `patientId` from `UpdateTriageEntryInput` (`Partial<Omit<CreateTriageEntryInput,
'patientId'>>`) and from `UpdateTriageEntryDto`, the same move as the appointments P1 fix's removal
of `status` from its update DTO: `linkPatient()` is now the *only* code path that can set this
field, full stop, not just the one nobody happens to call incorrectly today. `update()` also now
409s on any edit to an already-closed entry — the guard reads `entry.status` *before* applying the
incoming patch, so the transition *into* a closed status (e.g. `status: 'Discharged'` on an entry
that's currently `'Triaged'`) still goes through this same call unaffected; only a second edit after
closing hits the lock. Same "check current state before Object.assign, not after" shape as the
clinical-note sign-off lock (§70) and the discharge-summary `reviewedAt` lock.

**`triage_entries` was the one table migration 0053 missed.** `TriageEntry` never extended
`AuditableEntity`/`SoftDeletableEntity` — it duplicated its own `createdAt`/`updatedAt` columns and
had no `createdBy`/`updatedBy`/`deletedAt`/`deletedBy` at all. Migration 0053 (the broad
audit-columns backfill across tenant tables) verified each table's original CREATE TABLE migration
rather than assuming from the entity class, but `triage_entries` simply wasn't in its table list.
Added migration 0067 with the same `ADD COLUMN IF NOT EXISTS` shape as 0053, and switched
`TriageEntry` to extend `SoftDeletableEntity` like every sibling clinical entity — dropping its
duplicated `@CreateDateColumn`/`@UpdateDateColumn` in favor of the inherited ones (same column
types, so no data-shape change for those two).

## 72. Clinical/vitals P2/P3 batch: range validation, BMI overflow, stale-BMI nulling, dead code
    (2026-08-26)

Four items from the clinical/vitals section of `code-review-findings-2026-08-25.md`.

**Range-validate every vital sign, at bounds that also keep `decimal` columns from overflowing.**
None of the nine vital-sign fields had any `@Min`/`@Max` — a mistyped SpO2 of 970 or a negative pain
scale reached the DB as-is. Added bounds chosen at clinically plausible extremes, comfortably inside
each column's actual precision ceiling (`decimal(5,2)` maxes at 999.99, `decimal(4,1)` at 999.9):
height 0-300cm, weight 0-500kg, temperature 20-45°C, pulse/bpSystolic 0-300, bpDiastolic 0-200,
respiratoryRate 0-100, spO2 0-100, painScale 0-10 (matching the column comment's own documented
0-10 scale). Also switched the `int`-column fields (pulse, bpSystolic, bpDiastolic,
respiratoryRate, painScale) from `@IsNumber` to `@IsInt` while touching them — a decimal value for
an int column was silently truncating before, not rejected.

**`calculateBmi` no longer lets a valid-per-field-but-extreme height/weight combo overflow its own
column.** Both height and weight can independently sit inside their new DTO bounds (e.g. height
30cm, weight 500kg — a newborn's height with an adult's weight) and still compute a BMI (~5555) far
past `bmi`'s `decimal(5,2)` ceiling, which would have thrown a raw Postgres `numeric field overflow`
on `save()`. `calculateBmi` now returns `undefined` (no BMI recorded) instead of a value it can't
actually store — a derived/computed field should never be allowed to violate the column it's
headed for; skip persisting it rather than let the DB throw.

**Stale BMI nulling: `?? null`, not a bare `undefined`, when the recompute yields nothing.**
`repository.save(entity)` skips `undefined` properties in the generated UPDATE rather than nulling
them — assigning `vital.bmi = calculateBmi(...)` when that call returns `undefined` left whatever
BMI was already stored untouched. `update()` now assigns `calculateBmi(...) ?? null` whenever a
recompute is triggered, so a height/weight combination that no longer yields a valid BMI (cleared,
one side missing, or the overflow case above) actually nulls the column. Worth remembering as a
general rule: **anywhere a service recomputes a nullable derived field and skips reassigning it
when the computation yields nothing, check whether that's actually clearing the field or just
leaving a stale value in place** — `save()`'s undefined-skipping behavior makes the two look
identical in code but very different in the database.

**`listByAppointment` deleted.** No controller route, no other caller, no test coverage — genuinely
dead code, not a case of "used by future work."

## 73. Nursing P2/P3 batch: skippedBy, MAR audit columns, prescription link, discharged-admission
    guard (2026-08-26)

Four items from the nursing section of `code-review-findings-2026-08-25.md`. `MedicationAdministration`
and `NursingTask` share one file/migration, so all four landed together.

**`skippedBy`, a new actor column, not a reuse of `administeredBy`.** A skipped dose recorded no
actor at all — `administeredBy` stays null for a Skip (correctly: nothing was administered), and
there was no dedicated column for who made the skip call. Added `skippedBy` (`uuid`, matching the
existing `administeredBy`/`completedBy` actor-column type on these two entities — the
uuid-vs-varchar inconsistency those columns have is a separate, already-tracked cross-cutting
finding, not re-litigated by adding one more uuid column here). `skipAdministration()` now sets it
via the same `resolveActor()` every other sign-off on this service already goes through.

**`medication_administrations` gets the audit-columns backfill its sibling never lost.** Migration
0053 (the broad tenant-tables audit-columns pass) covered `nursing_tasks` but not
`medication_administrations` — both tables are created in the same migration (0037), so this was
plausibly just missed rather than deliberate. Added migration 0068 with the same `ADD COLUMN IF NOT
EXISTS` shape, and switched the entity to extend `SoftDeletableEntity` like its sibling.

**MAR-to-prescription link: nullable, raw-lookup-validated, no DB FK — matching the table's existing
convention, not inventing a new one.** `NursingService.assertAdmissionExists` already documented why
it uses a raw SQL lookup instead of an entity import for its cross-module admission check (nursing
has no module-boundary tag yet — a separate, already-tracked finding). Added `prescriptionId`
(nullable uuid, no FK) plus a new `assertPrescriptionExists`, same raw-lookup shape, validated only
when the caller supplies one. Nullable is deliberate: not every MAR line traces back to a formal
`clinical/encounters` `Prescription` (a nurse-initiated PRN intervention, for instance) — this closes
the "nothing ties a dose to what authorized it" gap for the common case without forcing every
existing/future caller through a prescription lookup that may not apply.

**Discharged-admission guard lives in the one choke point both creators already share.**
`createTask` and `createAdministration` both call `assertAdmissionExists` before doing anything
else — added the `status === 'Discharged'` check there instead of duplicating it in both methods,
so a future third caller of that helper inherits the guard for free.

## 74. OT P2/P3 batch: two-tier room-conflict detection without a duration model, per-transition
    actors, cancellation/post-op capture (2026-08-26)

Three items from the ot section of `code-review-findings-2026-08-25.md`. The room-conflict item is
worth a standing pattern note: **when a finding wants conflict detection but the data model has no
duration/end-time field, don't force a full interval-overlap engine — split the fix into what the
model actually supports.** `OtSurgery` has `scheduledAt` (an instant) and `status`, but no estimated
end time, so true "does surgery A's window overlap surgery B's window" detection isn't possible
without inventing that field (a larger modeling decision, left open). Two narrower, real checks
*are* supported by the existing fields, and both got implemented:

- **Exact-slot conflict** (schedule-time): `scheduleSurgery` rejects a second surgery booked into
  the same `otRoom` at the exact same `scheduledAt` instant — same shape as the appointments
  doctor-slot check.
- **True-concurrency conflict** (execution-time): a room can't have two surgeries genuinely running
  at once, regardless of what was scheduled — enforced with `UQ_ot_surgeries_active_room` (migration
  0071), a partial unique index on `otRoom` while `status = 'InProgress'`, mapped to 409 in
  `startSurgery` the same way every other constraint-backstop in this codebase is.

Together these close the two conflict shapes the current schema can express; a same-room booking at
9am and 2pm on the same day still isn't caught (nothing says whether the 9am surgery is done by
2pm) — that's the "no duration model" half of the finding, correctly left open rather than faked
with an incomplete overlap check.

**Per-transition actors, not just `scheduledBy`.** `startSurgery`/`completeSurgery`/`cancelSurgery`
each accepted an `actor` parameter and discarded it — added `startedBy`/`completedBy`/`cancelledBy`
(migration 0071), each now set via the same `resolveActor()` every sign-off in this codebase goes
through.

**Cancellation reason and post-op notes: new columns, not a reuse of the pre-op `notes` field.**
Reusing `notes` (set at scheduling time) for either would silently clobber the pre-op note. Added
`cancellationReason` and `postOpNotes` (migration 0071) plus `CancelSurgeryDto`/`CompleteSurgeryDto`
so a caller can supply them on the respective transition.

## 75. Patient-portal P2/P3 batch: view-type projections, isActive on every read, in-memory
    pagination for a multi-source merge, no-store everywhere (2026-08-26)

Four items from the patient-portal section, risk-gated (`/code-review high`) per this module's
direct PHI exposure — findings from that pass are tracked separately, not folded in here.

**Narrow view types, extending the pattern the module already had.** `listResults()` already
projected onto a hand-built `PatientResultView` instead of returning `LabResult`/`RadiologyRequisition`
raw; `listAppointments`/`listInvoices`/`listPrescriptions` didn't, leaking `createdBy`/`updatedBy`
(internal staff account ids) and `Appointment.cancelledRemarks`/`Invoice.notes` (internal staff
notes) straight to the patient. Added `PatientAppointmentView`/`PatientInvoiceView`/
`PatientPrescriptionView` as `Pick<>` types with an explicit column-name array passed to
`createQueryBuilder(...).select([...])` — TypeORM only hydrates the selected columns, so the excluded
fields are genuinely absent from the response, not just untyped. `Prescription.notes` was
deliberately kept: unlike the other two, it's written for the patient (medication instructions), not
staff-internal.

**`isActive` enforcement centralized into one new choke point, `assertPatientActive`.** The patients-
module pass (§68) fixed `getMe()` specifically; this pass generalized it — `assertPatientActive`
mirrors `assertPatientExists`-style helpers elsewhere in the codebase and is now the first call
inside every method's transaction. Necessary because a patient's JWT stays valid until it expires
(no logout/revocation exists yet, a separate tracked gap) — deactivation has to be enforced on every
read, not just checked once at login.

**`listResults()`: real pagination isn't possible without a bigger schema change, so this ships
in-memory pagination instead of faking DB-level support.** Lab and radiology results come from two
independent queries with no shared sort key at the DB level; paginating either independently would
make "page 2" undefined (you can't know where page 1 ended without merging both first). Added a
small `paginateInMemory()` helper (array in, `PaginatedResponseDto` out) and fetch-then-merge-then-
slice. This bounds the response payload — the actual bug the finding cared about — but doesn't
reduce the "5 sequential round trips," which traces back to neither result table carrying a direct
`patientId` (documented in the method's own comment as a schema-level gap, not something a
pagination fix can close).

**`Cache-Control: no-store` on all five routes, via one `@Header()` per method.** NestJS's `@Header()`
decorator is method-level only — there's no class-level equivalent that would let this live once on
the controller — so it's repeated five times, annotated with why at the class level so the repetition
reads as intentional rather than copy-paste.

## 76. Cross-cutting (clinical group) batch: filter-column indexes, RBAC seed drift, actor-column
    types (2026-08-26)

Three of four items from the clinical group's cross-cutting section closed this pass — the fourth
(module-boundary lint tags) needs `eslint.config.mjs`, which Claude cannot edit (see §69/§70's note
on `guard-config.sh`); left for a human hand-edit.

**Filter-column indexes: verified against each service's actual query, not assumed from the
entity.** Added migration 0072 covering nine tables across admissions/appointments/clinical-
encounters/triage/nursing/ot/maternity, one plain `CREATE INDEX IF NOT EXISTS` per column each
module's own `list()`/`find()` call filters on. Skipped three columns that already have adequate
coverage from an earlier fix in this same file: `discharge_summaries.admissionId` and
`maternity_records.admissionId` (both unique-indexed), `vaccination_records.patientId` (leading
column of its own unique index) — a reminder that a uniqueness fix already closes the "no index"
half of a later finding on the same column, worth checking before adding a redundant one.

**RBAC seed drift, same create-only caveat as every other RBAC fix.** Removed Nurse's
`order.manage`/`patients.create`/`patients.update` grants (PRD §6.1 gives Nurse read-only on Order
and doesn't mention Patient write access at all) from `ROLE_PERMISSION_MAPPINGS`. Same limitation
noted on every other RBAC seed change in this file: `ON CONFLICT DO NOTHING` means an
already-provisioned tenant's over-grant isn't retroactively revoked — this is the RBAC module's own
still-open "seed is create-only" finding, not something a code-only fix here can close. Caught a
stale test assertion in `seed-rbac-catalog.integration-spec.ts` expecting Nurse in `order.manage`'s
role list — updated to match the corrected grant.

**Actor-column type fix: `varchar`, matching the exact rationale already documented for audit
columns.** `triage_entries.triagedBy`, `nursing_tasks.completedBy`,
`medication_administrations.administeredBy`/`skippedBy` converted from `uuid` to `varchar`
(migration 0073, same `ALTER COLUMN ... TYPE varchar USING ...::varchar` shape migration 0053 used
for `nursing_tasks.createdBy`/`invoices.createdBy`/`journal_entries.createdBy`) — this codebase's
test suite signs tokens with human-readable `sub` values, which a uuid column rejects outright.
`skippedBy` (added this same review pass, not part of the original finding) was converted too,
rather than being left as a fresh instance of the exact inconsistency this fix exists to close.
`nursing_tasks.assignedTo` was deliberately NOT converted — worth the general rule: **not every uuid
column referencing an account is an "actor" column in this sense** — `assignedTo` records who a
task is *for*, not who performed a sign-off action, so it doesn't need the same accommodation for
non-uuid test `sub` values (nothing writes a test-signed value into it the way `resolveActor()`
does for actor fields).

## 77. Orders P2/P3 batch: cross-module cancellation cascade via per-module subscribers, row locks,
    itemType allowlist (2026-08-26)

Three items from the orders section of `code-review-findings-2026-08-25.md`, opening
`code-review-findings-2026-08-25.md`'s Diagnostics & Supply Chain pass.

**Cross-module cascade: per-module subscriber, not a single cross-domain one.** The finding
("cancelling an order item leaves its downstream requisition/dispensing live") needs orders'
cancellation to reach into lab/radiology/pharmacy — the reverse of those modules' existing
dependency on `orders`. `ChargeCaptureSubscriber` (billing reacting to `order_items` completing)
already established the pattern for this shape of problem: an `EntitySubscriberInterface` pushed
onto the shared `DataSource` from `OnModuleInit`, so it fires inside whatever transaction the
triggering write happened in. That subscriber had to filter on the raw `tableName` string instead of
`listenTo(() => OrderItem)`, specifically to avoid creating a new billing → orders module-boundary
edge. **The same trick doesn't apply here in reverse**: lab/radiology/pharmacy each already import
the `OrderItem` entity (a sanctioned edge already exists), so `LabOrderCancellationSubscriber` /
`RadiologyOrderCancellationSubscriber` / `PharmacyOrderCancellationSubscriber` each live in their own
module and bind via the typed `listenTo(() => OrderItem)`, no boundary workaround needed. Rejected a
single subscriber that raw-SQLs all three downstream tables from one place (e.g. inside `orders`
itself): it would dodge the boundary check via raw SQL instead of respecting it, and it would own
three other domains' status-transition rules (which statuses count as "still live") in a file that
isn't any of those domains' own. Three small subscribers, one per module, each reusing its own
module's exported `NON_TERMINAL_STATUSES` constant, keeps the "which statuses are cancellable" rule
defined exactly once, in the module that owns it.

**Row locks on `completeItem`/`cancelItem`: match the existing convention, no new regression test.**
Added `lock: { mode: 'pessimistic_write' }` to both lookups — the two-line fix every other
status-mutating method in this codebase already has. Per this repo's risk-gated test-rigor rule, a
P2 CRUD-status lock gap (not money, not tenant isolation, not a clinical sign-off field) doesn't
warrant a dedicated timing-based concurrency test the way the billing P1 deposit-refund lock did;
existing functional coverage already exercises both methods and passed unchanged.

**`itemType` allowlist: derived from actual call sites, not invented.** Grepped every
`itemType === '...'` comparison in the codebase (billing charge capture, patient-portal, seed data)
to confirm `Lab`/`Radiology`/`Pharmacy` are the only three values anything ever checks for, then
added `@IsIn([...])` — no new enum invented, no value guessed.

## 78. Lab P2/P3 batch: reference-range evaluation, worklist, constraint-name-checked catches, PDF
    cross-domain join (2026-08-26)

Six items closing out `code-review-findings-2026-08-25.md`'s lab section.

**Reference-range evaluation: computed value overrides operator input, not the other way round.**
`isAbnormal` was entirely operator-supplied even though `LabTestComponent` already carries
`referenceRangeLow`/`referenceRangeHigh`. The new `computeIsAbnormal()` helper evaluates the
component's numeric range against the entered value whenever both are usable, and that computed
result **wins over whatever the operator passed** — the finding's whole point was that a human
shouldn't be the sole authority on abnormality when a numeric range exists to check it against.
Falls back to the operator-supplied value only when the range can't govern: a qualitative component
(text-only `referenceRangeText`, e.g. Negative/Positive) or a non-numeric entered value (e.g.
"Hemolyzed"). Existing test fixtures were unaffected because none of them define a numeric range on
their components — worth remembering when writing a *new* lab fixture that needs a specific
`isAbnormal` outcome: pass `referenceRangeLow`/`referenceRangeHigh` explicitly if the range should
apply, or leave both unset if the test wants operator input to pass through untouched.

**Worklist: widen the existing endpoint, don't add a new one.** The finding was "no way to find a
requisition without already knowing its order item id" — `radiology`'s `findAll` already solved this
shape by making `orderItemId` optional and adding a `status` filter. Applied the identical fix to
lab's `listByOrderItem` (kept the method name — a full rename to `findAll` would've touched call
sites for no behavioral gain) rather than adding a second endpoint; `GET /lab/requisitions?status=
Pending` is now the worklist. The removed `requireParam(query.orderItemId, ...)` call was the
existing test's entire assertion surface, so that test was rewritten (not just deleted) into two new
assertions proving the status filter actually partitions Pending vs. SampleCollected requisitions.

**Constraint-name checks, not bare `23505`.** Both `lab-workflow.service.ts`'s `createRequisition`
catch and the new `lab-catalog.service.ts` `createTest` catch check `error.constraint === '...'`
against the specific unique constraint they're guarding, exactly like every other constraint-backstop
catch in this codebase (`admissions`, `appointments`, `radiology`, etc.) — never a bare `code ===
'23505'`, which conflates every unique-constraint violation on the table into one misleading error
message.

**PDF cross-domain join → `domain:lab` -> `domain:patients` boundary edge, blocked pending human
edit.** Same shape as the appointments/encounters `-> patients` edges from earlier passes: the fix
needs `PatientsService` injected into `LabWorkflowService` (plus `PatientsModule` imported into
`LabModule`), which needs a new `eslint.config.mjs` boundary policy Claude cannot add. Implemented
the correct fix anyway (replacing the raw `orders`/`order_items`/`patients` SQL joins with
`OrdersService.findOne` + `PatientsService.findOne`) and left the lint gap documented rather than
re-introducing the raw SQL to dodge a check that isn't wired up yet. This required updating every
manual `new LabWorkflowService(...)` construction across four other spec files to pass the new
`patientsService` constructor argument — a pure DI-wiring ripple, no behavior change in those files.

## 79. Radiology P2/P3 batch: a finding already closed by a root-cause fix still needs its own
    regression test (2026-08-26)

Two items from the radiology section. The P3 (`listByOrderItem` dead code, no callers) was a plain
delete — `findAll` already provides the same filter and is what the controller actually wires up.

The P2 is the more useful pattern: it cited the exact same root cause as the orders P1
(`completeItemInTransaction` resurrecting a Cancelled order item to Completed), which was already
fixed at its single choke point on 2026-08-25 — every caller, including radiology's `verify()`,
inherited that fix for free. **A finding closed as a side effect of another fix still needs its own
regression test scoped to *that* caller**, not just a checkmark citing the other fix: the orders-level
test only proved the guard works when `completeItemInTransaction` is called directly, not that
radiology's `verify()` actually reaches it with the right arguments in the right order. Added
`verify does not resurrect an order item that was independently cancelled` to radiology's own spec,
constructed to genuinely reproduce the race: this spec builds its services by hand (`new
RadiologyWorkflowService(...)`) rather than booting the module through Nest's DI, so the
order-cancellation-cascade subscriber added in the orders batch (§77) — which would otherwise
cancel the requisition itself the moment the order item is cancelled, making the race unreachable —
never registers. Cancelling the order item directly via `OrdersService` while the requisition
sits at `ReportEntered` leaves the requisition untouched, so `verify()` proceeds and must be the one
thing standing between a cancelled order item and a phantom completion.

## 80. Pharmacy P2/P3 batch: stock-only dispensing reversal that deliberately doesn't touch
    orders or billing (2026-08-26)

Three items from the pharmacy section, closing out that module's checklist entirely (the P1 FEFO
fix landed earlier, 2026-08-25).

**The reversal path (P2)** is the interesting design decision. The naive fix — reopen the linked
order item to `Pending` once its dispensing is reversed, so the "true" state is visible on the order
— was rejected: `orders`/`lab`/`radiology`/`pharmacy` all share one 3-state model
(`Pending → Completed | Cancelled`) through the single `OrdersService.completeItemInTransaction`
choke point, and nothing in this codebase ever transitions an item back to `Pending`. Reopening it
only for pharmacy would (a) break that shared invariant for the other two workflow modules riding on
the same choke point, and (b) reopen a double-billing risk — `ChargeCaptureSubscriber` fires on every
`→ Completed` transition, so a reopened-then-recompleted item would charge the invoice a second time
unless a billing return had already been run manually first.

The fix actually shipped is stock-only: `PharmacyDispensingService.reverseDispensing()` (valid only
from `Dispensed`, 409 otherwise) walks the `StockTransaction` rows the original dispense created
(`referenceId = dispensing.id`, `transactionType: 'PharmacyDispense'`), credits each amount back to
its originating `StockBalance` row under a `pessimistic_write` lock, records new
`PharmacyDispenseReversal` transactions for the audit trail, and marks the dispensing `Reversed`. The
order item and any captured invoice charge are left untouched — an invoice correction, if needed, is
a separate, staff-initiated `InvoicesService.createReturn` call, exactly like every other reversal in
this codebase (fraction, insurance never auto-reverse on a triggering event either).

To still let staff **re-dispense** against the same order item after a reversal (the actual workflow
need — a wrong drug/quantity, not a permanently dead order line), `createDispensing()`'s duplicate
guard was widened from "block unless the existing dispensing is `Cancelled`" to "block only if
`Pending` or `Dispensed`" — so a `Reversed` row no longer blocks a new one. This is safe without
touching the order item at all: `dispenseDrug()`'s call to `completeItemInTransaction` is already a
no-op when the item isn't `Pending`, so re-dispensing against an already-`Completed` item decrements
stock again but never re-fires `ChargeCaptureSubscriber`. **Any partial unique index backing a
status-based "no active duplicate" guard must be updated in the same migration as the guard itself**
— the 0024 index (`WHERE status <> 'Cancelled'`) would otherwise still treat a `Reversed` row as
active and reject the very insert the widened application check was built to allow; migration 0075
drops and recreates it as `WHERE status IN ('Pending', 'Dispensed')` to match.

**The RBAC gap (P2)** turned out to be half-fixed already: Hospital Admin's missing `pharmacy.read`
was a side effect of the rbac-module P1 fix earlier in this same findings pass (that fix granted
Hospital Admin every Pharmacy permission). Only Pharmacist's missing `inventory.read`/`order.read`
(PRD §6.1's "Inventory, Order" secondary read scope) needed a new grant — worth checking whether a
sibling fix already closed part of a finding before assuming the whole thing is still open.

**The dead code (P3)** was `listByOrderItem`, deleted — same shape as the lab/radiology dead-code
fixes earlier in this file (`findAll` already covers the same filter and is what the controller
actually wires up).

## 81. Inventory P2/P3 batch: goods-receipt hardening, a GROUP BY/HAVING report deliberately left
    unpaginated, and a code-uniqueness fix reused verbatim from lab (2026-08-26)

Five items, closing out the inventory section entirely (the P1 FEFO fix landed earlier,
2026-08-25, and is what this batch's `expiryDate` validation directly protects).

**Goods-receipt validation and test coverage** went together: `RecordGoodsReceiptDto.expiryDate`
was `@IsString()` only, so a garbage value would 500 at the `date`-column insert instead of 400ing
through `ValidationPipe` — switched to `@IsDateString()`. On top of that, `recordGoodsReceipt` now
rejects an `expiryDate` already in the past: receiving stock that's expired on arrival is never a
legitimate business operation, almost always a data-entry error, and would otherwise sit in
`stock_batches` as dead-on-arrival inventory (permanently invisible to FEFO after the pharmacy P1
fix). Same shape as vaccination's `administeredDate` future-date guard from this same review pass —
**a plausibility check on top of a format check**, not a replacement for one. The method had exactly
one existing test (actor derivation), despite three real invariants riding on it — over-receipt,
the atomic stock-balance upsert, and the PO status rollup — so all three got covered in the same
pass as the validation fix, since they share the one code path being touched anyway.

**The low-stock report** is the interesting shape: a `GROUP BY item.id` / `HAVING SUM(available) <=
reorderLevel` query over `inventory_items` LEFT JOINed to `stock_balances`, so an item with zero
stock batches still surfaces (COALESCE'd to 0) rather than being silently absent from a query that
never runs its `HAVING` clause. **This one query does not go through `paginateRaw()`**, unlike every
other list in this module — deliberately: `paginateRaw()`'s `getCount()` runs on the same query
builder the data query uses, and a `GROUP BY`/`HAVING` aggregate is exactly the shape TypeORM's count
machinery isn't built for (it wasn't invented for this batch — every existing `paginateRaw()` caller
in this codebase is a flat join, no aggregation). Whether a list needs pagination is a data-volume
question, not a reflex: this result set is bounded by business meaning (only items actually below
their reorder point), not by how much data exists, so an unpaginated array is the honest contract,
not a shortcut. A full reorder *alert* (a notification firing when a level is crossed) is a separate,
larger feature this finding didn't require — this only had to close the "stored but never queried"
half.

**The two constraint additions** — `UQ_inventory_items_code` and `CHK_stock_balances_available_quantity_non_negative`
— reuse patterns this file has already established: the code-uniqueness fix is the
`UQ_lab_tests_code` shape (migration 0074) applied to a second table, and the CHECK constraint got
a regression test that goes around the application layer entirely (`manager.query()` UPDATE, not
the service) specifically to prove the DB constraint is the actual backstop, not just app-code that
happens to also prevent the same outcome — `FefoStockDecrementService` already rejects
insufficient-stock at the application level, so a test through that path alone wouldn't have proven
the CHECK constraint does anything at all.

## 82. Ward-supply P2/P3 batch: a ward-level batch ledger that mirrors the central store, a
    signed-delta Adjust, and the recurring raw-lookup cross-module validation (2026-08-26)

Six items, closing out the ward-supply section entirely. Three reusable shapes emerged.

**The ward sub-store now has a batch dimension, modeled exactly like the central store's.**
`ward_stock_batches` holds one row per (departmentId, itemId, batchNumber) lot with its own
`quantity`, and `WardStockBalance.availableQuantity` is treated as the sum of those rows — the
same aggregate-over-batches split `stock_balances`/`stock_batches` already do at the central
store, just scoped to a department. Three details made this tractable rather than a big feature:

- **`''` (empty string) is the sentinel for stock received without batch provenance**, and it is
  a plain column default, not a nullable column — a nullable `batchNumber` would silently defeat
  the UNIQUE (departmentId, itemId, batchNumber) index, because Postgres treats NULLs as distinct,
  so a second unbatched receipt would create a second row instead of upserting onto the first.
  The ledger (`ward_stock_transactions.batchNumber`) still surfaces `null` for those rows, so the
  sentinel never leaks into API responses.
- **The migration backfills the sentinel row for every pre-existing balance**
  (`INSERT ... SELECT "availableQuantity" FROM ward_stock_balances`), so the balance == sum(batches)
  invariant holds from the moment the table exists — a new dimension must never land as a
  "no data yet" table next to live aggregate rows, or every consumption immediately breaks.
- **Receiving already-expired stock is rejected at the service** (same guard as the inventory
  goods-receipt fix, §81) — without it, the FEFO consumption rule below would silently strand an
  expired lot as un-consumable inventory that still occupies the aggregate balance.

**All decrements share one FEFO path, including the new ledger types.** `consumeStock`,
`returnStock`, and `wasteStock` are thin wrappers over a private `decrementStock` that locks the
aggregate balance, refuses to go negative, then calls `decrementBatchesFefo` — earliest expiry
first, `expiryDate >= CURRENT_DATE` excluding expired lots, the `''` sentinel (NULL expiry) last
via NULLS LAST, each `UPDATE ... RETURNING` guarded by a `quantity >= portion` predicate under a
pessimistic lock, one ledger row per lot touched carrying that lot's batchNumber/expiryDate. This
is the ward-level analogue of `FefoStockDecrementService` (§17/§18), including the
`[rows, rowCount]` tuple-shape caveat. **`Adjust` is the one exception that proves the "one
ledger row per lot" rule is a means, not an end**: a stocktake delta has no batch provenance, so
it records exactly one ledger row with the *signed* delta (positive or negative), while the
underlying batch rows still move (positive → the `''` lot; negative → FEFO, per-lot rows
suppressed) to keep the aggregate invariant true. Don't let a ledger's normal shape dictate what
an unusual movement type must look like — decide the invariant first (balance == sum of batches),
then let each type record the most honest representation of itself.

**Cross-module reference validation stays raw-query, even for the master-data and clinical
domains.** ward-supply was already doing a raw `SELECT id FROM inventory_items` for the item
check; the batch adds the same shape for `departments` (the P2 gap), `patients`, and `admissions`
(the P3 gap) — no entity imports, no new module-boundary edges, matching `assertAdmissionExists`
in nursing and every sibling module. When a module needs to validate a foreign id, the answer
continues to be a scoped raw lookup, not a new dependency edge. Note the DTOs for this module
were also switched from `@IsString()` to `@IsUUID()` on every uuid field while they were being
touched — the read DTO already used `@IsUUID`, and leaving write DTOs looser turns a bad id from
a clean 400 into a raw Postgres 500 (see the platform-group P3 that calls this class of bug out).

## 83. CSSD P2/P3 batch: a status-partial unique index, the third code-uniqueness fix, and
    closing a write-only field with a read endpoint (2026-08-26)

Five items, closing out the cssd section entirely. Three shapes, all already established in this
file, worth noting for how they compose.

**The InProgress-cycle guard is the admissions/ot pattern verbatim**: an in-transaction pre-check
(`SELECT ... WHERE "instrumentId" = $1 AND status = 'InProgress'`) that gives a friendly 409, plus
a partial unique index (`UQ_cssd_sterilization_cycles_active_instrument` on `(instrumentId) WHERE
status = 'InProgress'`) as the race-safety backstop, with the constraint name checked in the catch
so a concurrent duplicate still maps to 409 instead of a raw 500. A status-partial unique index is
how this codebase says "at most one *active* row per X" — it has now been applied to admissions
(patient/bed), appointments (doctor slot), ot (room), and cssd (instrument). When a status value
moves a row out of the guarded set (Completed/Failed frees the instrument), no index surgery is
needed — the row simply stops matching the predicate.

**The code-uniqueness fix is the lab pattern for the third time** (`UQ_cssd_instruments_code` +
a `QueryFailedError` catch checking `error.constraint === 'UQ_cssd_instruments_code'`, 0078 after
0074/0076). One recurring pitfall worth stating: the catch must check the *constraint name*, not
a bare `23505` code, because a `23505` can arrive from any unique index the insert touches — a
bare code check mislabels unrelated collisions (see the lab P3 finding that fixed exactly this).

**The sterility read closes a write-only field with a derivation, not a new column.**
`sterileExpiryAt` was computed on every Completed cycle but nothing ever consulted it, so the
instrument's usable sterile state was unknowable. Rather than storing a redundant
`isCurrentlySterile` flag (which would go stale and need its own lifecycle), `getSterility()`
derives it on read from the latest Completed cycle (`isSterile = sterileExpiryAt > now`), exposed
as `GET /cssd/instruments/:id/sterility`. Deriving a status from authoritative timestamps beats
caching it: there is exactly one source of truth and no transition to maintain.

Also folded in: `reactivateInstrument` gained the already-active 409 that `deactivateInstrument`
already had (symmetric idempotency guards), and plain non-unique indexes were added on the cycles
table's two filter columns (`instrumentId`, `status`).

## 84. SSU P2/P3 batch: a maker/checker split on the write-off decision, and two status-lifecycle
    guards (2026-08-26)

Three items landed; the fourth (subsidyPercent applied to nothing) was deferred to
`new-features.md` #19 because it is a cross-module money feature, not a batch fix. Three shapes:

**The maker/checker split is a new guard shape for this codebase.** `approveCase` is where a
charity subsidy (a revenue write-off) becomes real, so it now rejects with a 409 when the
resolved approver equals the case's `appliedBy` — the same actor cannot both create and approve a
write-off. Two details worth copying: the guard runs *after* the status check but *before* any
mutation (so the transition into Approved is what's being gated), and it compares the *resolved*
actor (`resolveActor`), not the raw DTO value — a spoofed `approvedBy` cannot dodge it, and an
unauthenticated non-HTTP caller (no fallback supplied) is skipped entirely rather than spuriously
409ing. Note the scope decision: only approval is guarded, not rejection — rejecting a case
writes off nothing, so the maker may still reject their own case; the split protects the
money-moving transition specifically.

**The one-Open-case-per-patient guard is the status-partial unique index again** (pre-check +
`UQ_ssu_cases_active_patient` on `(patientId) WHERE status='Open'`, 0079) — the fourth use of the
"at most one *active* row per X" pattern after admissions, appointments, ot, and cssd. And the
test restructuring it forced is worth noting: two specs had created two Open cases on one patient
in sequence, which the new rule makes impossible — the fixture had to interleave the status
transition (approve the first before opening the second). A new invariant that the old fixtures
violated is a signal the invariant was real, not a nuisance: "only one Open case per patient"
meant those fixtures were modeling a state the business had already ruled out.

**`closeCase` got its audit columns** (`closedBy` varchar nullable, `closedAt` timestamptz) via
migration 0079 — deliberately varchar for the actor column, matching the §73 rationale (test
tokens sign non-uuid `sub` values) even though the entity's older `appliedBy`/`approvedBy`
columns are still uuid-typed; new audit-style actor columns follow the varchar convention going
forward.

## 85. Fraction P2/P3 batch: a reversal subscriber that hooks the *invoice* update, a default-rule
    uniqueness guard, and the RBAC fix (2026-08-26)

Three items, closing out the fraction section (its P1s landed 2026-08-25). The reversal is the
interesting shape; the other two reuse established patterns.

**The automatic reversal subscriber's trigger point matters — hook the invoice update, not the
returns insert.** The gap was: an entry stayed live (and payable) after its source invoice was
returned or cancelled. The fix is a tableName-filtered subscriber in the fraction module (no
fraction → billing entity import, same boundary-clean shape as `ChargeCaptureSubscriber`) that
reverses the invoice's live entries in the same transaction on two events: `invoices` afterUpdate
where status becomes `Cancelled`, and `returns` afterInsert. The subtle part is why the return
path listens on `invoices` rather than `returns`: `InvoicesService.createReturn()` saves the
Return row *before* updating the invoice's totalAmount, so a returns-insert hook fires with the
stale total in hand — but the invoice update fires after the money moved, inside the same
transaction. When a subscriber must react to a multi-step mutation, pick the event that carries
the *post-mutation* state, not the first event in the sequence. (For cancellation it made no
difference — the entry only needs the invoice id — but one hook covering the reliable event
keeps the design single-shaped.)

**Reversal is all-or-nothing, matching the entry's snapshot design.** `FractionEntry` documents
itself as a snapshot (percent + base at recording time); recomputing a live entry's base to a
partially-returned invoice's new total would violate that contract and create a moving target the
payroll side can't trust. So both return and cancel void the entry (`reversedAt`/`reversedBy`,
idempotent — already-reversed rows are skipped), and the partial-recompute alternative is
explicitly left open. Also note the reversal column follows the §73 varchar convention
(`reversedBy`), and the subscriber is fail-loud: a reversal that throws aborts the cancel/return
transaction rather than silently leaving a stale payable share — the same stance `createReturn`'s
journal post already takes. Subscriber wiring is proven e2e by a spec booting the real AppModule
(cancel, return, and an unrelated-payment control that must NOT reverse).

**The default-rule guard is the status-partial unique index pattern again** — a doctor's default
(null-department) share is single-valued, so `createRule` pre-checks plus
`UQ_fraction_rules_active_default_per_doctor` on `(doctorId) WHERE "departmentId" IS NULL AND
"isActive" = true` (0080), with the `recordEntry` fallback additionally ordered
`createdAt DESC` so legacy ambiguity resolves to the newest rule deterministically rather than
arbitrarily. And the RBAC fix simply applies PRD §6.1: Fraction & Incentive moved from
Billing/Accounts Staff (whose scope is Billing/Insurance/Accounting/Verification) to HR/Payroll
Admin (whose primary scope names Fraction & Incentive explicitly).

## 86. Billing P2/P3 batch: proportional GST reversal on returns, and a settings-driven default
    tax for charge capture (2026-08-26)

Two P2 fixes landed; the IGST/HSN model was deferred to `new-features.md` #20. Both money-shape
decisions are worth recording.

**Returns now reverse the GST split proportionally, and the proportion is the tax-to-total
ratio.** A return is amount-based (`CreateReturnInput` carries only amount/reason), so it cannot
allocate itself to specific invoice lines. The invoice-level split is reversed by the returned
amount's share of the invoice's tax: `taxShare = round(tax * amount / total)`, with
`taxableShare = amount - taxShare`, and `subtotal`/`taxableAmount`/`taxAmount` all shrink
accordingly. The arithmetic is exact rather than approximate because every quantity is already
2-decimal money: `total = taxable + tax` is preserved to the paisa after the split, and the P1
invariant (a later charge-capture recompute of `totalAmount = subtotal - discount + tax` can't
re-inflate past the return) still holds with tax included. Two things deliberately NOT done, both
documented in the finding: per-line `cgst`/`sgst` reversal (needs a line-based return model) and
any change to the return journal (still amount-based, matching the no-GST-liability model below).

**Charge capture reads its tax from a configured default, and the journal books the full line
total.** `billing_settings.defaultTaxPercent` (migration 0081, 0-100, default 0) is the seam —
the same settings row that already carries GSTIN/state code. Captured lines now carry
`taxPercent`/`cgst`/`sgst`/`totalAmount` computed from it, and the invoice's `taxAmount` moves
with the line. The journal amount is the line's full total (unitPrice + tax) because this
codebase has **no GST-liability ledger account** — tax is rolled into revenue exactly as
`recordPayment` already does for manual-invoice payments (debit Cash/AR, credit AR/revenue, no tax
split anywhere). Introducing a real GST liability account is net-new accounting-model work (a
seeded ledger account, split journals on capture *and* payment *and* return), explicitly out of
scope for a finding whose ask was "the line carries 0% tax".

Also of note: the backward-compatible default (omitted `defaultTaxPercent` → 0) keeps every
existing client and test working unchanged, and the capture spec's tax tests must reset the shared
tenant's settings back to 0 — the settings row is per-tenant singleton shared across all tests in
the describe block, so a tax-configured test leaks into later tests without cleanup.

## 87. Accounting P2/P3 batch: structural account guards, exact-money aggregation, and a raw-SQL
    soft-delete gap (2026-08-26)

Seven items, closing out the accounting section. Four shapes worth recording.

**Account type is structural; the guard is "journaled → frozen".** `updateAccount` now 409s a type
change when the account has any `journal_lines`, because the type drives report classification
(trial balance / income statement / balance sheet) — changing it re-classifies *history* the
moment it's saved. The system accounts (the fixed ids in `ledger-account-codes.ts`) are a second,
stronger case: they're load-bearing for billing's auto-posted journals, so they reject type
changes and deactivation outright while still allowing cosmetic name edits. The shape to copy:
`isSystemAccount()` derives from the id set, and the journaled check is a raw `SELECT 1 ...
LIMIT 1` — existence-only, cheapest possible.

**Money sums stay numeric until the last moment.** The trial-balance aggregation was
`COALESCE(SUM(...), 0)::float8` — float8 has 53 bits of mantissa, so large money sums (₹100M+)
can silently drop paise *before* `roundMoney` ever runs. `::numeric` keeps exact decimal
arithmetic; node-postgres returns numerics as strings, so the mapping converts with `Number()`
and rounds in JS. When a report must be exact, cast to numeric in SQL and round in the
application, not the other way around.

**Raw SQL inherits the soft-delete filter by hand.** TypeORM only appends `deletedAt IS NULL` to
repository-generated queries; a raw `manager.query` join silently includes soft-deleted rows.
trialBalance's raw join now filters `j."deletedAt" IS NULL` explicitly — a reminder that any raw
query over a SoftDeletableEntity table must re-apply the filter itself (the regression test
soft-deletes a posted journal via raw UPDATE and asserts it drops out of the report).

**The remaining three were pattern-fills**: `ListJournalsQueryDto` extends `PaginationQueryDto`
(the service already paginated — only the DTO stripped `page`/`limit`, the recurring class of bug
this file keeps fixing), `postJournal` row-locks via a `lock` flag on the shared `loadJournal`
helper, and `CreateJournalDto.entryDate` is `@IsDateString()`. The accountCode uniqueness fix
(0074-shaped, migration 0082) also surfaced that the accounting spec's fixtures reused the
seeded system accounts' codes (1000/1010/2000/4000/4900) across tests in the shared tenant —
previously invisible because duplicates were legal; the fixtures were renumbered to distinct
codes, which is what the new constraint requires.

## 88. Insurance P2/P3 batch: insurer settlement finally moves money, and the coverage-freeze
    guard (2026-08-26)

Six items, closing out the insurance section (its P1 caps landed earlier). Two shapes dominate.

**markClaimPaid now records a real payment — the module's first money movement, and its first
cross-domain service dependency.** Previously the claim flipped to Paid and nothing else
happened: no journal, no payment record, the insurer-settled invoice stayed Unpaid. The fix
records an `Insurance` payment against the claim's invoice through `InvoicesService.recordPayment`
(a new `Insurance` payment mode; the payment posts the usual Cash/Patient-AR journal). Three
decisions worth recording:

- **The payment is recorded FIRST, and the claim flips to Paid only after it succeeds** — a
  failed settlement leaves the claim Approved, not falsely Paid, and fails loud. `recordPayment`
  rejects an amount exceeding the invoice's outstanding balance, so a claim approved against an
  already-paid invoice surfaces as an error for billing staff to resolve, never a silent cap.
- **The reimbursement journals as cash-in.** This codebase's ledger has no Insurance-Receivable
  account (only the five seeded system accounts), so the insurer's settlement is treated like a
  cash payment, exactly as every other payment mode already is. A receivable-then-settlement
  model is net-new accounting work, out of scope for this fix.
- **It crosses the insurance → billing boundary** — `InsuranceModule` now imports `BillingModule`
  and the service injects `InvoicesService`. Insurance was previously untagged in the eslint
  `boundaries/elements` list (the cross-cutting boundary finding), so the import doesn't trip
  lint today; tagging insurance (and every other untagged domain) plus the new edge is part of
  that still-pending cross-cutting item, deliberately not smuggled into this batch.

**The coverage-freeze guard is the accounting pattern applied to a policy.** Coverage terms
(`sumInsured`, coverage window) are the basis every approval was capped against (the P1 sum
checks) — so once a policy has any claims, `updatePolicy` 409s changes to them, while
administrative fields (policyNumber/insuredName/relationship) stay editable. Same shape as the
accounting "journaled → frozen" rule (§87): a field that history was computed against becomes
immutable once that history exists. The partial-update fix (`requirePolicyNumber` flag on the
shared validator) and the policy-number uniqueness index (`UQ_patient_policies_patient_payer_number`,
0083) fill out the batch; `checkCoverage` gained the payer-active requirement with its own
`payer-inactive` reason, and `submitClaim` stopped stamping `processedBy`/`processedAt` — those
belong to adjudication, not submission.

## 89. Platform-billing P2/P3 batch: calendar periods, vendor invoices with numbers and GST, and
    a widened period-uniqueness index (2026-08-26)

Three items landed; proration was deferred to `new-features.md` #21. Three shapes:

**Subscription periods are calendar-sized now.** The 30/365-day constants drifted: "monthly" from
Jan 31 ended Feb 1 (30 days later), and renewals compounded the drift forever. `addMonths` does
calendar arithmetic with day-clamping (Jan 31 + 1 month = Feb 28 — the source day is clamped to
the target month's last day when it doesn't exist), and renewal advances by the invoice's own
cycle measured in *calendar months*, not ms. Note the test change this forced: the
advance-by-invoice-length test asserted ms-equality between consecutive periods — which is
precisely the drift being fixed (Feb 15 → Mar 15 is 28 days, not the 31 of Jan 15 → Feb 15) — so
it now asserts calendar-cycle consistency instead. When a fix removes a behavior a test
enshrined, check whether the test was testing the bug.

**The vendor's own invoices got numbers and GST.** `subscription_invoices` gained
`invoiceNumber`/`taxPercent`/`taxAmount` (migration 0084 — a PLATFORM migration, public schema,
not tenant; new platform columns require running `nx run api:migrate` against the shared DB, which
is how the public schema gets every platform migration). The number is derived deterministically
from (subscriptionId, periodStart) — guaranteed unique by the period index below, no sequence
table needed. The tax rate is a named constant (`PLATFORM_GST_PERCENT = 18`) rather than a
hardcoded literal buried in the method — a product decision the platform owner can change in one
place, surfaced to the Tech Lead in the findings note rather than silently invented.

**The period-uniqueness index widened from open-only to all statuses.** The original partial
index (`WHERE status='open'`) meant a paid period could theoretically be re-invoiced by a later
path once the subscription's `currentPeriodStart` moved on; the full unique index on
(subscriptionId, periodStart) closes that, and `issueInvoice`'s duplicate lookup dropped the
status filter to match. The regression test proves it by resetting a subscription's current
period onto a PAID invoice's period and asserting the 409 — a state the old index would have
admitted.

## 90. Payroll P2/P3 batch: the ledger finally sees payroll, and a run-level advisory lock (2026-08-26)

Five items, closing out the payroll section. Two shapes dominate; the other three are pattern-fills.

**Payroll posts to the ledger at the money-moving moment.** `markPaid` now books a Salary Expense
debit / Salaries Payable credit for the payslip's net amount through `postAutoJournal` on the
caller's manager (same idempotent `(sourceType, sourceId)` mechanics as every other auto-post,
fail-loud). Two decisions worth recording: the ledger accounts are **seeded per tenant by
migration 0085** (`SALARY_EXPENSE`, `SALARIES_PAYABLE`, added to `LEDGER_ACCOUNT_IDS`) — same
create-only caveat as the original five system accounts, so an existing tenant gets them on the
next migrate run; and the journal books only the **net** payable — deduction-side liabilities
(PF/ESI/TDS as separate liabilities between gross and net) are a larger payroll-accounting model,
explicitly out of scope. One consequence surfaced by tests: a payroll payment now *requires* a
resolvable actor (the journal's `createdBy` is NOT NULL), so `markPaid` with neither an
authenticated principal nor a fallback fails — that's the §25 audit-integrity convention doing
its job, not a regression.

**A run-level advisory lock fixes the concurrent-run abort.** Two concurrent
`runMonthlyPayroll` calls for the same month both observed "no payslip yet" for an employee, both
inserted, and the loser aborted its ENTIRE run on the `(employeeId, periodMonth, periodYear)`
unique violation — the duplicate killed the run, not just the row. `withAdvisoryLock(manager,
\`payroll:${month}:${year}\`)` inside the transaction serializes the runs: the second waits, its
pre-check sees the first's committed rows, and it skips. This is the same lock-based serialization
shape as billing's charge-capture and platform-billing's tenant lock — when a write path has an
"at most one per key" invariant and a pre-check, add the lock so the loser *waits* instead of
*crashing*.

**The pattern-fills**: `deductionPercent` capped at 100 (a deduction above gross nets negative)
with `CHK_payslips_net_non_negative` as the DB backstop; the raw employee query re-applies
`"deletedAt" IS NULL` by hand (raw SQL bypasses TypeORM's soft-delete filter — see §87); and the
per-employee `findOne` in the run loop is replaced by one batch `find` into a `Set` (the N+1).
The spec fixtures also had to learn the module's new reality: the run payslips *every* live
employee in the shared tenant, so tests must scope assertions to the employee they inserted, and
the markPaid journal test needs a resolvable actor.

## 91. Fixed-assets P2/P3 batch: a back-fill that books real money, and the accrual finally posts
    to the ledger (2026-08-26)

Five items, closing out the fixed-assets section. Three shapes worth recording.

**Back-filling a period must compare against the latest period BEFORE it, not the latest
overall.** The old prior-entry lookup took `order: { periodYear DESC, periodMonth DESC }` with no
period predicate — so a back-fill of March compared March's (smaller) accumulated figure against
June's (larger) one and booked `max(0, 15000 − 18000)` = ₹0, silently. The fix adds the
strictly-before predicate `(periodYear < :year OR (periodYear = :year AND periodMonth < :month))`
to the query. The lesson: any "previous value" lookup for a *retroactive* write must bound the
search to the domain being back-filled; an unconstrained "latest" silently produces zero-delta
no-ops exactly when the caller is trying to correct history.

**The accrual posts to the ledger — with a ₹0 skip.** Each non-zero charge books Depreciation
Expense / Accumulated Depreciation via `postAutoJournal` on the caller's manager (idempotent on
the `Depreciation` source key, fail-loud). The two ledger accounts are seeded per tenant by
migration 0086 and added to `LEDGER_ACCOUNT_IDS`, matching the payroll pattern (§90) — the ledger
account set is growing by seeding, not by runtime creation. The notable detail: a ₹0 charge (a
fully-depreciated asset's trailing period, or the old back-fill bug) deliberately skips the
journal — `postAutoJournal` rejects zero-amount lines, and a no-op row isn't a financial event.
When a batch produces entries that are sometimes zero, the journal must be conditional on
non-zero, not assumed.

**The valuation-freeze guard is the same shape again** (third use after accounting §87 and
insurance §88): once depreciation entries exist, `updateAsset` 409s changes to
cost/date/useful-life/salvage — the inputs history was computed from — while administrative
fields stay editable. `salvageValue > purchaseCost` is rejected on create and re-checked
post-update (a negative depreciable base otherwise), and `resolveActor` gained the standard
fallback parameter. This closes the Financial & Billing group's money modules except the two
remaining cross-cutting items.

## 92. Accounts P2/P3 batch: one password policy everywhere, and the failed-login counter gets a
    lock (2026-08-26)

Four items, closing out the accounts section. Two shapes:

**Password policy is enforced at the service, once per path.** `createStaffAccount` and
`resetPassword` accepted admin-supplied passwords of any length (only "non-empty" was effectively
checked) while `changePasswordByUsername`/`changeOwnPassword` enforced 8 characters — a tenant
could be provisioned with a 1-character Hospital Admin password through the admin path. Both admin
paths now reject `password.length < 8` with a 400 before hashing. The rule: **every path that
accepts a password enforces the same minimum at the service layer** — DTO validation is a
convenience, not the guarantee, because service methods are also called directly (seeds, other
services, tests). The tenants-side DTO half of the sibling auth finding stays in the tenants
batch, per the file's file-scoped batch convention.

**The failed-login counter is a row-locked read-modify-write now.** `recordFailedLogin` and
`lockAccount` loaded the account without a lock, so concurrent brute-force attempts could
lost-update the counter below the lockout threshold — the exact failure mode the lockout is meant
to stop. Both now use `pessimistic_write`, matching every other read-modify-write in the
codebase. Also folded in: duplicate staff usernames map `23505` to a 409 (the patient-account
path already did; the staff path now matches), and `deactivateAccount` 409s an already-deactivated
account — the catalog convention the finding names. Note the spec fixture that asserted
idempotent double-deactivation had to flip to expect the rejection: the finding's whole point was
that the old behavior was wrong, so the test was testing the bug.

## 93. Financial cross-cutting: closing the money-path test gaps (2026-08-26)

The review's money-test-gap finding named seven paths; this closes the two that weren't already
covered inside their module batches and records where the rest live. The notable discovery: the
concurrent-depreciation-accrual test didn't exist because **the race itself still existed** —
`runDepreciationAccrual` had the exact abort-the-whole-run failure payroll had (two concurrent
runs both observed "no entry", both inserted, the loser aborted on the `(assetId, periodMonth,
periodYear)` unique). It now takes the same run-level advisory lock (`depreciation:<month>:<year>`),
and the test proves both runs fulfill with exactly one entry per asset. The pattern to remember:
**when a review names a "missing test" on a concurrency path, write the test before assuming the
underlying code is fine** — the test-gap item for payroll's concurrent runs was closed by the
payroll fix, but the sibling accrual path had never been fixed because no test forced the issue.

The other named paths were already proven by tests added inside their own module batches
(cancel-vs-reversal-journal and capture-after-return in charge-capture; `updatePolicy` and
claim-cap-vs-invoice in insurance; back-filled depreciation in fixed-assets; concurrent payroll
in payroll). The concurrent deposit-refund test was genuinely missing in its own right: two
concurrent same-amount refunds now provably decrement the balance exactly once (P1 row lock +
P2 journal pre-check serialize them; the second sees the first's DepositRefund journal and
no-ops). The module-boundary-lint half of this section is the same `eslint.config.mjs` work as
the clinical-group boundary item — tracked there, not duplicated.

## 94. Auth P2/P3 batch: the lockout decision uses the authoritative counter, and password
    fields get their bounds (2026-08-26)

Three items landed; token revocation was deferred to `new-features.md` #22. The lockout fix is
the shape worth recording.

**The lock decision must use the counter's authoritative post-increment value.** `login()` used
to compute `account.failedLoginAttempts + 1` from the account row it loaded at the START of the
request — stale under concurrent failures — and locked only when that stale value crossed 5. The
accounts batch made `recordFailedLogin` a row-locked read-modify-write (the single writer); this
batch makes it *return* the new count and makes `login()` decide from that return value. The
rule: when a threshold decision depends on a counter that other requests also mutate, the decision
must be made from the mutation's own result, not from a snapshot taken before the mutation. A
counter that "can't quite reach" its threshold under load is a lockout that never fires.

**Password fields got explicit bounds at the DTO layer.** `@MaxLength(72)` on login/change
password — bcrypt's byte limit — so an over-long password 400s at the pipe instead of silently
truncating on verify (a 73-byte password verifies as its truncated 72-byte prefix, which is a
footgun); `ProvisionTenantDto.adminPassword` gets `@MinLength(8)`/`@MaxLength(72)`, closing the
"provision a tenant with a 1-character Hospital Admin password" half that the accounts batch's
service-side fix didn't reach. **Token revocation stays deferred**: stateless rotation already
prevents refresh-token reuse, but a stolen token remains valid until expiry without a revocation
store — the natural home is the Redis/blacklist integration (`new-features.md` #11), captured as
#22 rather than hacked into a schema the platform's Redis plan already supersedes.

## 95. RBAC P2/P3 batch: guard metadata reads both levels, the audit trail gets its own
    permission, and the seed stops being create-only (2026-08-26)

Six items, closing out the rbac section (its P1s landed earlier). Three shapes worth recording.

**The permission guard reads handler metadata, then class metadata.** `Reflector.getAllAndOverride`
over `[handler, class]` makes handler-level requirements win and class-level requirements honored
as the fallback — the old handler-only read silently ignored a class-level `@RequirePermission`,
a latent trap that would have shipped as a no-op the day someone used it. Two test-design notes:
the lib spec's mock Reflector had to grow `getAllAndOverride` (mocking only the method the code
*used to* call is how this regression slipped through — mock the current contract), and
`getClass()` must return `undefined`, not `{}`, in mocks — an empty object is truthy and turns
"no metadata" into "a required permission".

**The audit trail got its own permission.** `audit.read` (catalog + seed + controller) replaces
the `reporting.read` reuse — a reporting grant no longer implies audit access, and revoking
reporting no longer silently kills the trail. This is the "split a read permission off a shared
one" shape the billing batch already used (`billing.read`, §80); when one permission gates two
distinct concerns, split it and re-grant both to the roles that legitimately hold both
(Super Admin / Hospital Admin / Auditor/Compliance here).

**The seed stopped being create-only for the catalog rows.** Roles and permissions now seed with
`ON CONFLICT (name) DO UPDATE` on the mutable metadata columns, so a code change to a seeded
role/permission propagates on re-run — the old `DO NOTHING` meant edits in code silently never
reached existing databases. Two deliberate limits: mappings stay *additive* (new mappings insert;
removing a seeded mapping remains a manual step, because an orUpdate can't delete and a
reconcile-delete would clobber custom assignments), and conflict targets are the natural-key
columns (name), not the surrogate id. Also folded in: the unmapped-prefix warning (a stripped
permission whose prefix is in no module key and isn't always-on now logs once per prefix), the
hospital role-picker's `isCrossTenant = false` filter, and the `roles_name_key` 23505 → 409 catch
for concurrent role creation — the constraint name verified against the live DB (an inline
`UNIQUE` on a column auto-names as `<table>_<column>_key`, not TypeORM's `UQ_*` scheme).

## 96. Tenants P2/P3 batch: provisioning retry from a clean slate, a purge that can't be
    deadlocked, and purged tenants that stay dead (2026-08-26)

Five items, closing out the tenants section (its P1 landed earlier). Three shapes:

**Provisioning failure cleanup now removes everything this call created.** The old cleanup deleted
only the registry row, leaving the tenant schema — and its bootstrap admin account — behind on the
theory that the schema was "resumable" (`CREATE SCHEMA IF NOT EXISTS` + idempotent migrations).
But the admin insert isn't idempotent: the retry's `createBootstrapAdmin` collided with the
leftover account's unique username, so a failure after that insert made the hospitalId
unretryable without manual DB surgery. The cleanup now drops the schema and role too (best-effort,
after deleting the registry row). The safety argument is the interesting part: the schema belongs
to this provisioning attempt because a *successful* provisioning would have committed the registry
row and the retry's early existence check would have caught it — so dropping the freshly-created
schema can never destroy a live tenant's data. When a cleanup path deletes partial state, it must
delete ALL of the partial state it created, not just the first thing it finds.

**DROP ROLE can't deadlock the purge anymore.** `DROP ROLE` is the one DDL in the purge that a
lingering session (or an ownership block) can hang indefinitely — inside the transaction, that
hang rolled back the whole purge on every retry, a no-progress loop. It now runs post-commit,
best-effort, like the logo removal: `DROP SCHEMA` + the registry-row update stay transactional
(they're the PHI-critical part), and a leftover role is harmless because provisioning's `CREATE
ROLE` is existence-guarded. The purge-failure spec's premise flipped with the contract — it used
to prove a blocked role drop rolled everything back; it now proves the purge completes despite the
block, and cleans the role up once the blocking object is released.

**The remaining three are pattern-fills**: the four status mutators now share an
`assertNotPurged` guard (a purged tenant's schema is gone — restoring it to 'active' would be a
tenant every login fails on); deactivated catalog roles can't be enabled (provision `roleIds`,
`setTenantRoles`, and the package-default resolver all filter/reject `!isActive`); and
`roleIds`/`departmentCatalogIds` are `@IsUUID({ each: true })` instead of plain strings, so a bad
id 400s at the pipe instead of 500ing on the FK.

## 97. Master-data P2/P3 batch: a read permission for the layout endpoints, and two guard
    mirrors (2026-08-26)

Four items, closing out the master-data section. Two shapes:

**The layout GETs are permission-gated now.** Every department/ward/bed GET endpoint was
unguarded — the controller had `@UseGuards(PermissionGuard)` but no `@RequirePermission`, so any
authenticated account (including a patient-portal one) could enumerate the hospital's physical
layout. The fix adds a dedicated `master-data.read` permission (catalog + seed) and applies it to
all six GETs, granted to the staff roles that legitimately need the layout for their screens. Two
specs had tests titled "allows listing for any authenticated session" — they were asserting the
vulnerability as a feature; both were rewritten to assert the 403 and a read-granted 200. When a
review flags an endpoint class as unguarded, search for tests that assert the unguarded behavior
and rewrite them, not just the controller.

**The guard mirrors are "deactivate checks its dependents, reactivate checks its prerequisites."**
`deactivateDepartment` already refused while an active child existed; `reactivateDepartment` now
refuses while the parent is deactivated (the mirror: deactivation protects dependents,
reactivation protects the tree's consistency). `deactivateWard` now refuses while any bed is
`Occupied`, mirroring `deactivateBed` — a ward with a patient in it can't be taken down. And the
three creators got the standard 23505 → 409 backstop, with constraint names verified against the
live DB (inline-column `UNIQUE` names like `departments_departmentCode_key` differ from
explicitly-named ones like `UQ_beds_ward_bed_number` — check before hardcoding).

## 98. Platform-branding P2/P3 batch: bounding a pre-auth surface, and keeping an external call
    out of a locked transaction (2026-08-26)

Two items, closing out the platform-branding section. Two shapes:

**A pre-auth endpoint that must exist gets throttled, not removed.** `GET /branding` is
unauthenticated by necessity — the login page renders branding before any session exists, and the
tenant identity can only come from the caller-controlled `x-tenant-id` header. The finding called
it an enumeration oracle; the fix bounds the probe surface (a per-IP throttle, same shape as the
other unauthenticated endpoints) and relies on what was already uniform: `getPublicBranding`
returns an identical all-null shape for unknown tenants and mistyped ids (no 404-vs-200
existence signal) and exposes only public fields. When an endpoint *must* stay unauthenticated,
the fix is to (a) make the response uniform across existence, and (b) rate-limit it — not to add
an auth wall that breaks the flow it exists for.

**External calls don't belong inside a locked transaction.** The logo upload held the branding-row
advisory lock and an open transaction across the object-store `putObject` — a slow upload
serialized every other branding write. The upload now happens first (outside any transaction: a
failed upload leaves the DB untouched), then the lock + transaction update the row, then the old
object is removed best-effort after commit. The residue analysis is what makes the reorder safe: a
failure *before* the upload changes nothing; a failure *between* upload and commit leaves at most
an orphaned object, which the next upload's cleanup removes; nothing can leave the DB row pointing
at a missing object, because the DB write happens only after the upload succeeded.

## 99. Notifications P2/P3 batch: a real permission for a decorative gate, and query-shaped
    indexes (2026-08-26)

The P2 is a small but telling shape; the P3 index half is a pattern-fill; the retention half was
deferred to `new-features.md` #23.

**A decorative guard is fixed by giving it something real to check.** `NotificationsController`
had `@UseGuards(PermissionGuard)` with no `@RequirePermission` anywhere — the guard always
returned true, and the package-catalog comment even admitted the `notifications` module mapping
was dead ("no permissions in the catalog ... effectively always-on"). The fix adds a real
`notification.read` permission, grants it to every catalog role (the endpoints are self-scoped —
recipient-only — so the permission gates feature access, not data visibility), and applies it as
a **class-level** `@RequirePermission` — the first production use of the class-level guard support
added in the rbac batch. Worth noting: the dead mapping was *documented as dead* in a comment —
that's exactly the "unmapped prefix fails closed with no signal" class of drift the rbac batch
warned about, now with a real permission behind the prefix.

**Indexes are named after the query shapes they serve.** The old single-column
`(recipientAccountId)` index served neither hot read well; migration 0087 replaces it with
`(recipientAccountId, createdAt DESC)` (newest-first list + summary's recent rows) and a partial
`(recipientAccountId) WHERE isRead = false` (the unread count — a partial index is the canonical
shape for a boolean-filtered count). Retention (a delete job for old rows) is deferred: this
codebase has no scheduler, and a cleanup path is an ops feature, not a schema fix.

## 100. Helpdesk P2/P3 batch: raising a ticket is a staff-wide action, and the assignee must be
    real (2026-08-26)

Three items, closing out the helpdesk section. Two shapes:

**"Anyone can raise, agents manage" is a permission split, not a looseness.** The create endpoint
required `helpdesk.manage` (admins/agents only), so ordinary staff — the very people tickets are
for — couldn't raise one. The fix adds a `helpdesk.create` permission granted to every staff role
(the same "grant the raise action broadly, keep the queue narrow" split the notifications batch
used for `notification.read`). When a permission gates an action that should be available to most
users, split it off from the manage permission rather than loosening the manage grant.

**The assignee must be a real, active account.** `assignTicket` took any string — a typo'd id
silently handed the ticket to nobody. It now raw-looks-up the account (404 missing, 409
deactivated), same cross-module-reference shape as every sibling module. The spec fixtures had to
learn the new reality: they assigned to a bare UUID with no backing row, which the new validation
correctly rejects — the fixtures now seed the account (the pattern established by the
notifications subscriber spec). The list-filter indexes (`status`/`assigneeAccountId`/`createdAt
DESC`, migration 0088) round out the batch.

## 101. Marketing P3 batch: source-name uniqueness, UUID write-path validation, and a
    marketing.create permission for the front desk (2026-08-26)

Three P3s, closing out the marketing section — all pattern-fills this file has now established.

**Source-name uniqueness** is the lab_tests shape for the fourth time (`UQ_referral_sources_name`,
migration 0089, plus the constraint-name-checked 409 catch in `createSource`) — referral sources
with duplicate names would make the picker ambiguous and the referral source-identity unreliable.

**Write-path ids matched the read path's `@IsUUID`** — `RecordReferralDto` had `@IsString` on its
uuid columns while `ListReferralsQueryDto` correctly used `@IsUUID`, so a bad id 400'd on reads
but raw-500'd on the FK at write. This is the recurring "string-typed fields against uuid columns"
class (see the platform cross-cutting P3 that names it); each module batch keeps fixing its own
instance.

**`marketing.create` split the referral action off `marketing.manage`** — same "broad grant for
the common action, narrow grant for management" shape as `helpdesk.create` (§100) and
`notification.read` (§99): front-desk roles (Receptionist / Front Desk, Billing/Accounts Staff)
can record a referral at registration without being able to manage the source catalog.

## 102. Reporting P2/P3 batch: revenue means net money collected, and one pagination contract
    (2026-08-26)

Three items landed; the CSV-streaming half stayed bounded-but-deferred. Two shapes:

**Revenue is net money actually collected.** The dashboard summed `PaymentRecorded + DepositReceived`
— a deposit that later funded a payment fired BOTH events, so the same money counted twice, and
refunds were never subtracted (no return event existed). The fix: revenue =
`SUM(PaymentRecorded) − SUM(InvoiceReturned)` in one CASE-based query, `DepositReceived` excluded
(a deposit is a liability until applied), and the reporting subscriber gained a `Return` insert
handler so returns flow in. The regression test runs in a *fresh tenant* because revenue is a
whole-tenant aggregate — reusing the shared tenant would sum the other tests' events. When
testing an aggregate, isolate the tenant. (Deposit refunds were left out: the deposit row stores
one refundedBy/refundedAt pair with no per-refund identity, so a refund event can't be derived
from the row — the invoice-return path is the tractable half.)

**One pagination contract.** `listEvents` returned `{ items, total }` while every other list in
the codebase returns `{ data, meta }` — a second contract the frontend would have to special-case.
It now goes through the shared `paginate()` + `PaginationQueryDto`, and the controller's
hand-rolled page/limit parse is gone (the shared DTO clamps identically — this was the "reporting
hand-rolls a second, divergent pagination contract" finding, and the fix is "use the shared one",
never "document the divergence"). The date-range filters became `@IsDateString()` DTOs at the same
time (garbage dates 400 at the pipe instead of reaching SQL).

## 103. Audit P2/P3 batch: filter-column indexes for the trail, and the read-audit gap deferred
    (2026-08-26)

One item landed here; the permission half was closed in the rbac batch; the read-audit half was
deferred to `new-features.md` #24.

**The audit table got indexes on the columns the search actually filters.** `audit_records` had
zero indexes — every audit search scanned the whole table, which only gets worse as the trail
grows (and the trail never shrinks; retention is a separate gap). Migration 0090 adds
`occurredAt DESC` (the default 24h range), `tableName`, `recordId`, `changedByAccountId`, and
`correlationId` — each matching a filter the `AuditService` applies. This is the "index the
filter columns, verified against the service code" shape from the clinical cross-cutting batch.

**The read-audit gap is a genuine compliance feature, not a schema fix.** Auditing reads means
tracking who *viewed* a patient record — the audit subscriber only fires on entity
insert/update/remove, and there's no read-event infra anywhere. That's net-new platform work
(read-event volume, storage/index design, endpoint coverage decisions), captured as
`new-features.md` #24 and tied to the India-compliance roadmap rather than half-built into this
batch. The `audit.read` permission half of the section was already closed by the rbac batch
(§95) — the trail no longer rides on `reporting.read`.

## 104. Packages P2/P3 batch: one source of truth for package modules, and gating that fails
    toward the minimum tier (2026-08-26)

Two items, closing out the packages section. Two shapes:

**The code catalog is now the single source of truth for a package's module list.** The DB row
stored `modules` and the catalog defined them too — a catalog edit changed nothing about actual
gating until a migration updated the DB rows. `getPackage` now overrides the DB row's `modules`
with the catalog's when the code exists there, so gating (which runs at every login/refresh via
`filterPermissions`) reflects catalog changes immediately. The general rule: when two stores
carry the same fact, make one authoritative at READ time rather than trying to keep both in sync
— an override in the resolver beats a migration-driven backfill every time.

**Unresolvable packages gate toward the BASIC tier, not open.** `filterPermissions` previously
returned the full permission set when a tenant's package row couldn't be resolved (no registry
row, unknown code) — the comment justified it as a legacy/edge case, but "give a tenant
everything" is a terrible failure mode for exactly the misconfiguration you'd want contained. It
now gates against the BASIC catalog tier (the minimum any tenant could have): Enterprise-only
permissions are stripped even for the unresolvable case, and a legit tenant with a healthy
package is unaffected. The spec's test literally asserted the fail-open behavior ("fails open for
a tenant with no registry row") — a test that names the bug it asserts is a gift; rewrite it to
the new contract and keep the name honest.

## 105. Employee P2/P3 batch: pagination DTO, UUID writes, and unique email/phone (2026-08-26)

Three items, closing out the employee section — all pattern-fills:

**The list DTO extends `PaginationQueryDto`** — the recurring "service paginates fine, the DTO
strips page/limit, the list is pinned to page 1" bug (this file's most-repeated class; see §83,
§87, §89). **`departmentId` is `@IsUUID` on writes** matching the read DTO (string-typed uuid
columns 500 on the FK — the platform cross-cutting P3's exact shape). **Email/phone uniqueness**
uses partial unique indexes (`WHERE email IS NOT NULL` / `WHERE phone IS NOT NULL`) — the
nullable-column twist on the codebase's standard uniqueness fix: a plain UNIQUE constraint would
let only one NULL row exist, so nullable-but-when-present-unique columns need the partial form.
`createEmployee` and `updateEmployee` both map the violation to a 409, and `@IsEmail` gives the
format check at the pipe.

## 106. Database P2/P3 batch: a DB password guard, removing a dead timer, and migration-ordering
    guards (2026-08-26)

Four items, closing out the database section. Two shapes worth recording; the migration-ordering
item deserves the most care.

**The migration-ordering investigation corrected the repo's own mental model.** The migration
skill claimed TypeORM sorts by each migration name's last-13-character timestamp — but the
migrations-table history proves otherwise for array-loaded migrations: legacy interleavings (the
2-prefix tenant migrations before the 1-prefix backfills; platform 0064's 3-prefix before 0084's
1-prefix) all ran *exactly as the arrays list them*, i.e. TypeORM executes array-loaded
migrations in array order. The finding's complaint — ordering carried by one hand-maintained array
— is therefore literally true and can't be fixed by "sorting by timestamps" (that would change
execution). The honest hardening: document the array-is-execution-order contract on the arrays,
enforce append-only by guarding the two failure modes a test can actually see — every migration's
sort key stays unique (so any timestamp-based tooling stays deterministic) and the modern 3-prefix
block stays ascending (appending a new migration out of order in the tail is the failure that
would silently run DDL before its dependencies). One extraction trap surfaced: the sort key is the
*last 13 characters* of the name, not "all trailing digits" — `AddInvoiceItemChargeUnique0049
2000000000049` would otherwise parse as 49,200,000,000,049 instead of 2,000,000,000,049.

**The other three are pattern-fills.** The DB password got the `resolveJwtSecret` production guard
(throw when `NODE_ENV === 'production'` and the var is unset — a known default credential must
never be silently usable in production). The pool monitor was removed rather than repaired: it
read a pool TypeORM never exposes there, so it was dead code *and* a permanent timer — when dead
code also holds a resource, deletion is the fix, not instrumentation. The missing secondary
indexes on newer tenant tables were closed by the modules' own batches where they existed (0087,
0088, 0090) and migration 0092 for the remainder (`employees`, `patient_referrals`).

## 107. Platform cross-cutting P3 batch: closing the string-typed-uuid sweep, and acknowledging
    the throttler fix (2026-08-26)

Both platform cross-cutting items closed. The throttler item was already fixed by the auth P1
(the finding itself said it was "the single highest-impact fix in this set" — it landed with the
auth batch, §94); this batch closes the sweep.

**The string-typed-uuid sweep is the finding this repo keeps re-discovering per module.** Every
module batch has been fixing its own instance (tenants, marketing, employee, helpdesk,
master-data); this item names the pattern explicitly: a `uuid`-typed column validated as a plain
string turns a bad id from a clean 400 into a raw Postgres 22P02/500 on the FK. The durable rule,
now applied everywhere in the sweep: **write-path uuid fields use `@IsUUID`, matching the read
path** — the read DTOs have been correct all along, which is why the asymmetry was discoverable.
A grep for `@IsString()` on uuid-column fields is a cheap lint for the whole codebase; each module
batch keeps closing its instance, and this sweep closes the named set.

## 108. Migration-history squash + seed data moved out of migrations (2026-08-27)

**The squash.** The 92-file migration history (0001-0092) was consolidated into **two immutable
baselines** — `0093-initial-platform-schema.ts` (the final public-schema state of the 15 platform
migrations) and `0094-initial-tenant-schema.ts` (the final per-tenant-schema state of the 77
tenant migrations). Both were **generated from `pg_dump --schema-only` of fully-migrated reference
schemas, not hand-written**: the whole 0001→0092 ALTER chain (varchar→uuid conversions, audit-
column backfills, constraint/index additions) collapsed into final `CREATE TABLE` statements, and
every index, constraint, CHECK and partial unique index carries its production name. Doable only
because we're pre-production: every database is resettable (the shared local dev/test DB), which
is the one condition that makes rewriting schema history safe.

**Verification — the schema a fresh DB gets is unchanged.** BEFORE: reference dumps of the public
schema (re-provisioned from the old platform migrations) and of a fresh tenant schema (provisioned
from the old tenant migrations). AFTER: identical dumps from the squashed baselines. The platform
schema is **byte-identical**; the tenant schema differs only in pg_dump's round-trip re-rendering
of cast placement in **three CHECK/partial-index predicates** (`radiology_requisitions` report-
entered/scanned checks, `pharmacy_dispensings` active-order-item unique index) — semantically
identical predicates with identical row coverage, verified by eye and by the full suite, which
re-provisions every schema from the baselines (961+ tests green). Any future drift between a fresh
provision and an upgraded one is caught by the same trick: dump both, diff.

**The new migration regime.** Baselines are **append-only and never hand-edited** — a hand-edit
would silently diverge every fresh schema from the contract. Schema changes ship as NEW migration
files with unique 13-digit sort keys appended to `PLATFORM_MIGRATIONS`/`TENANT_MIGRATIONS`
(index.spec.ts guards uniqueness, the ascending modern block, and that exactly the two baselines
are present). The old "committed migrations are immutable" rule now applies to the baselines
themselves.

**Seed data moved out of migrations** (Tech Lead decision, matching the pre-existing
`seed-rbac-catalog` pattern): the SaaS packages (was migration 0048) moved to
`seedPackagesCatalog()` in `packages/seed-packages-catalog.ts`; the nine system ledger accounts
(was migrations 0059/0085/0086) moved to `seedSystemLedgerAccounts()` in
`accounting/seed-ledger-accounts.ts`, whose data now comes from `LEDGER_ACCOUNTS` in
`ledger-account-codes.ts` — **the single source of truth**, killing the old "kept in sync with the
literals below" hazard migration 0059's comment documented. Backfills that were no-ops on a fresh
schema (0027's `tenant_roles` CROSS JOIN, 0048's `UPDATE tenants`, 0077's `ward_stock_batches`
backfill) were dropped by design — a baseline only ever runs against a fresh schema with zero rows.

**Wiring — where the guarantee lives now.** Tenant provisioning (`TenantProvisioningService`)
seeds the ledger accounts immediately after the migration run, on the same tenant-scoped
connection (skipped for empty migration lists — the backfill gate's bare-schema simulation), so
every provisioned tenant gets its chart of accounts exactly as before. The test harness seeds the
packages catalog unconditionally (`tenants.packageCode` has `DEFAULT 'basic' REFERENCES
packages(code)`, so any tenant-row insert needs the rows). `seed-all` now runs migrate →
seed-rbac → seed-packages → seed-initial-setup → seed-ledger-accounts; `seed-ledger-accounts`
(the `apps/api/src/database/seed-ledger-accounts.ts` runner) mirrors `migrate-tenants` for
already-provisioned schemas. Fresh platform DB: `seed-all`. Existing tenants: `migrate-tenants` +
`seed-ledger-accounts`.

## 109. DTO file convention: one class per file, `<action>-<entity>.dto.ts` (2026-08-27)

The eleven `<module>.dto.ts` single-file DTOs (ssu, vaccination, payroll, cssd, fraction, nursing,
maternity, ot, helpdesk, fixed-assets, encounters) were split into per-action files so the whole
codebase follows ONE naming rule (Tech Lead decision, prompted by the `helpdesk.dto.ts` vs
`create-department.dto.ts` inconsistency):

- **One DTO class per file.** File name mirrors action + entity: `create-<entity>.dto.ts`,
  `update-<entity>.dto.ts`, `assign-<entity>.dto.ts`, `cancel-<entity>.dto.ts`, … — whatever verb
  the endpoint performs (`record-delivery.dto.ts`, `run-depreciation.dto.ts`, `skip-
  administration.dto.ts`). List/search DTOs are `list-<entity>.dto.ts` / `search-<entity>.dto.ts`
  even when the class is named `List<Entity>QueryDto` (matching the pre-existing
  `list-invoices`/`search-patients` files). Only module-local constants a class needs (e.g.
  maternity's `DELIVERY_TYPES`) travel with it.
- **Every new DTO file follows this rule** — a `<module>.dto.ts` catch-all is a convention
  violation, same as a hand-rolled list DTO that duplicates `PaginationQueryDto` (§86).
- **Near-identical entity names get a disambiguating prefix.** The platform `department_catalog`
  DTOs were renamed `create-platform-department.dto.ts` / `update-platform-department.dto.ts`
  (`CreatePlatformDepartmentDto`/`UpdatePlatformDepartmentDto`) so they can never be confused with
  the tenant `departments` DTOs (`create-department.dto.ts`, `CreateDepartmentDto`) — the
  `platform-` prefix is the repo's established marker for public-schema concepts
  (platform-billing, platform-branding).

## 110. Frontend accessibility: recurring gaps and the fix pattern (2026-08-31)

An app-wide accessibility sweep (prompted after several module-group reviews had already fixed the
same issues piecemeal — see `review-comments.md`'s per-group "Accessibility" findings and its
"app-wide accessibility follow-up audit" section) found the same three gap shapes recurring across
otherwise-unrelated modules. Treat these as house rules for every new screen, not one-off fixes:

- **Every icon-only `p-button`/`<button>`/`<a>` needs `ariaLabel`/`aria-label`.** A `[text]="true"`
  or bare-icon button with no visible text label is silent to a screen reader without one. Back
  buttons get a destination-specific label (`ariaLabel="Back to appointments"`, not a generic
  `"Back"`) so the announcement tells the user where they'll land — copy the pattern from whichever
  `goBack()`/`routerLink` target the button actually navigates to, don't hardcode a single generic
  string across screens with different destinations.
- **Every form field needs its `<label>` and control connected** — `<label for="fieldId">` paired
  with `id="fieldId"` on a plain `<input>`/`<textarea>`, or `inputId="fieldId"` on a PrimeNG
  component (`p-select`, `p-inputNumber`, `p-datepicker`, …). A `<label>` sitting next to a control
  with no `for` looks correct visually and passes every automated test/build check, but a screen
  reader never announces it on focus — this is invisible to `tsc`/`nx test`/`nx build` the same way
  an undefined `glass-*` CSS class is (§21), so it only surfaces by grep or manual audit. When a
  label doesn't map to one specific control (e.g. a labeled section containing a search box, a
  results list, and a manual-entry fallback), pair it with the section's primary input rather than
  leaving it unassociated.
- **Never signal state by color alone.** A colored dot/border/background needs accompanying text
  (visible or `sr-only`) or an icon change alongside it — a `p-tag` with visible status text is
  already fine (color is redundant there); a bare `<span class="bg-blue-500 rounded-full">` with no
  text is not. Mark the purely-decorative color element `aria-hidden="true"` and add the real
  signal as adjacent text.
- **A custom clickable `<div>`/`<span>` needs `role="button"`, `tabindex="0"`, and both
  `(keydown.enter)`/`(keydown.space)` handlers** alongside its `(click)` — a `(click)`-only div is
  invisible to Tab and unreachable by a keyboard-only user. (A purely decorative overlay/scrim that
  isn't a control a keyboard user needs to reach, like a mobile sidebar backdrop, still gets this
  treatment for consistency once it's already being fixed, but is lower priority than an actual
  clickable row/action element.)

None of these are caught by `tsc --build`, `nx test`, or `nx build` — they require either a
targeted grep sweep (`grep -rn` for icon-only `p-button`/bare `<label>` without `for`/color-only
`<span>` patterns) or a manual pass, the same discovery method used here.

## 111. Manual per-method row-level scoping via an optional JWT claim (2026-09-01)

Nurse ward-scoping (`review-comments.md`'s "PRD-promised ward-scoped row-level access for Nurse")
is the second instance of a pattern first established by the patient-portal's `patientId` scoping
— use this as the template for any future "restrict this role to a subset of tenant rows" feature,
rather than inventing a new mechanism (a generic guard/interceptor was considered and rejected: it
would need to know per-entity how to resolve "is this row in scope," which is exactly the part
that's genuinely different per module).

- **Optional claim, absent means unrestricted.** Add a nullable column to `accounts`
  (`wardId uuid`, migration `0096-add-account-ward.ts`) rather than a required one — an account
  with the claim unset keeps today's tenant-wide behavior. This is what makes the feature
  incrementally adoptable: existing accounts are unaffected until an admin opts one in.
- **Claim flows through the same four hops as every other JWT-derived value**: embedded in
  `buildAccessPayload()` at login/refresh (`auth.service.ts`) → `AccessTokenPayload`
  (`auth-context.middleware.ts`) → `RequestContext` (`request-context.ts`) →
  `RequestContextStore`, read via a `getXxx()` accessor (`tenant-context.service.ts`). Add the
  field at all four points in the same commit — a claim wired at only some of them fails silently
  (e.g. present in the JWT but never reaching `AsyncLocalStorage`).
- **Enforcement is manual, per-method, at the top of each service method that touches the scoped
  entity** — not a generic guard. `NursingService`/`VitalsService`'s `assertWardAccess*` private
  methods are the template: a no-op when the actor's claim is unset, a raw cross-module query
  (never an imported entity — see §"cross-module reference" convention) to resolve the target
  row's scope value, `ForbiddenException` on mismatch. An unfiltered *list* method needs a second
  helper (`scopeToOwnWard`) that adds a `WHERE` subquery instead of throwing — listing is "show
  what's in scope," not "assert one row is in scope."
- **A dependent entity with no scope column of its own resolves it transitively.** `Vital` has no
  `wardId`; `assertWardAccessForPatient` looks up the patient's current active admission and uses
  *its* ward. When the transitive path can be absent entirely (a patient with no active admission),
  get an explicit product decision on allow-vs-deny rather than picking one — this repo chose deny
  (see the resolved finding above), the stricter option, because a silent unscoped write is worse
  than a nurse needing an admin to fix a wrongly-scoped account.
- **The admin-facing assignment endpoint validates against the owning module's table via raw
  query** (`AccountsService.setWard` → `SELECT id FROM wards WHERE id = $1 AND "isActive" = true
  AND "deletedAt" IS NULL`), same cross-module-raw-query rule as the enforcement side. `null`
  clears the assignment; the DTO's `@IsOptional()` (not a separate "clear" endpoint) is what makes
  that possible while still validating a non-null uuid.

## 112. Joining a display name into a list endpoint beats an N+1 lookup on the frontend (2026-09-01)

`AdmissionsService.listActive` (Ward Board, `review-comments.md`'s "No ward/bed board" finding)
joins the occupant's patient name/number into the query server-side rather than returning bare
`patientId`s and making the frontend fetch each patient individually. Unlike Nursing's
`assertAdmissionExists` (raw SQL query against another module's table, §"cross-module reference"),
this one uses a real `createQueryBuilder(...).innerJoin(Patient, 'patient', 'patient.id =
admission.patientId')` — `AdmissionsService` already imports the `Patient` entity directly
elsewhere in the same file (`admit()`'s existence check), so a typed join is the consistent choice
here, not a new pattern; raw SQL is for modules that don't already have that entity in scope.

- **`getRawAndEntities()`, not `getMany()`, when you need columns from the joined table that
  aren't a mapped relation on the entity.** `Admission` has no `@ManyToOne` to `Patient` (this
  codebase deliberately avoids cross-module TypeORM relations — raw uuid FKs only), so
  `leftJoinAndSelect` isn't available; `.select('admission').addSelect(['patient.firstName', ...])`
  plus `getRawAndEntities()` returns `{ entities, raw }` in matching order, where `raw[i]` carries
  the extra columns under TypeORM's default `<alias>_<column>` key (e.g. `patient_firstName`) —
  confirmed empirically via the integration spec, not assumed, since this was the first use of
  `getRawAndEntities()` in this codebase.
- **A response shape addition is safe to make without a frontend contract change first** — the
  service's return type changed from `Admission[]` to `ActiveAdmissionWithPatient[]` (an `extends
  Admission` superset) and the existing consumer (`AdmissionList`, whose `activeAdmissionsAll`
  signal is typed `Admission[]`) kept compiling untouched, since a wider joined type structurally
  satisfies the narrower one. Prefer this additive-extension shape over a breaking rename/removal
  whenever an existing endpoint just needs *more* data, not different data.

## 113. Displaying a raw-uuid FK: use the shared directory resolver, not another per-endpoint join (2026-09-01)

§112's per-endpoint join is the right call when a screen needs one specific list enriched (Ward
Board needed *only* `listActive`). It stops being the right call once the same "this id needs a
name" problem shows up on nine unrelated screens (`review-comments.md`'s "patientId/doctorId/
wardId/bedId shown as raw UUIDs across most of the app") — joining every one of those list/detail
endpoints individually would mean nine near-identical raw queries maintained forever. Use the
shared mechanism instead:

- **Backend**: `POST /directory/resolve` (`backend/code/apps/api/src/directory/`) takes
  `{ patientIds?, doctorIds?, wardIds?, bedIds? }` (arrays of uuids, `@IsUUID('4', { each: true })`,
  capped at 300) and returns `{ patients, doctors, wards, beds }` — each a `Record<id, { displayName,
  ... }>` with entries only for ids that actually resolved (soft-deleted, cross-tenant, or unknown
  ids are silently absent, not an error). Add a new entity type here (e.g. a future `departmentId`)
  by adding one field to the DTO, one query to `DirectoryService.resolve`, and one key to the
  response shape — not a new endpoint. Deliberately no `@RequirePermission` (§ the resolved finding
  above) — see `notifications.controller.ts` for the precedent of "any authenticated request, no
  specific permission" for endpoints that only ever echo back data the caller already possesses.
  Queries run **sequentially inside `runInTenantSchema`, never via `Promise.all`** — they share one
  pg client, and concurrent queries on a single client are unsupported (surfaces as a `pg`
  deprecation warning in tests if you get this wrong, not just a lint nit).
- **Frontend**: drop `<hms-entity-name [type]="'patient'|'doctor'|'ward'|'bed'" [id]="x.someId">`
  in wherever `{{ x.someId }}` used to be (inside an existing `<a routerLink>` if there was one —
  it renders inline). `DirectoryResolverService` (`frontend/.../directory/directory-resolver.service.ts`)
  batches every `resolve()` call made in the same microtask into one HTTP request — a whole
  `@for` loop's worth of table rows becomes one network call, not N — and caches resolved names
  for the app's lifetime. Never call `DirectoryApiService` directly from a component; the whole
  point is the batching layer.
- **Testing implication**: any component importing `EntityName` needs a `DirectoryResolverService`
  mock provider in its spec — even if no test in that file asserts on a resolved name — because
  `EntityName`'s `inject(DirectoryResolverService)` runs the instant Angular instantiates it, which
  happens on the first `fixture.detectChanges()` that renders a row carrying an id. Missing this
  provider fails with `NG0201: No provider found for InjectionToken API_BASE_URL` (the real
  `ApiClientService`'s dependency chain), not an obviously-related error — recognize that error
  shape as "a spec is missing a `DirectoryResolverService` provider," not an `ApiClientService`
  problem.

**Correction (2026-09-02):** `EntityName`'s original template rendered the resolved name followed
by the raw UUID in a small mono suffix (`{{ name }} ({{ id }})`) — a debugging affordance from
when the component was first built, apparently never removed, which shipped the exact raw-UUID
display this component exists to eliminate to every one of its consumers (found live across
Nursing, OT, Admissions, and tenant history). Fixed: the success branch now renders only the
resolved name; `DirectoryResolverService.formatName()` appends a patient's `patientNo` (the one
type with a second human-readable identifier worth showing — matching every patient-search
picker's own `patientLabel()` format), every other type shows the bare `displayName`. The raw-id
fallback stays, but only for the case resolution genuinely fails.

## 114. A server-searched `p-select` for large-cardinality pickers (patients), not a bulk-loaded one (2026-09-01)

The Appointments Doctor/Department pickers (§ the resolved "raw-UUID text inputs" finding)
bulk-load every option once and let `p-select`'s built-in `[filter]="true"` filter client-side —
correct for staff/department lists, wrong for patients (thousands of rows, unbounded). Orders' and
Nursing's patient pickers use the same `p-select` component but wire its `(onFilter)` output to a
debounced server search instead:

```html
<p-select
  [options]="patientOptions()" [ngModel]="patientIdFilter()" (ngModelChange)="patientIdFilter.set($event)"
  [filter]="true" (onFilter)="onPatientFilterSearch($event.filter)" [loading]="patientSearching()"
  emptyFilterMessage="Type at least 2 characters to search" placeholder="Search for a patient"
></p-select>
```

```ts
onPatientFilterSearch(query: string): void {
  clearTimeout(this.patientSearchTimer);
  const q = query.trim();
  if (q.length < 2) { this.patientOptions.set([]); return; }
  this.patientSearchTimer = setTimeout(() => {
    this.patientSearching.set(true);
    this.patientsApi.search({ page: 1, limit: 10, q }).subscribe({
      next: (res) => { this.patientOptions.set(res.data.map((p) => ({ label: ..., value: p.id }))); this.patientSearching.set(false); },
      error: () => this.patientSearching.set(false),
    });
  }, 300);
}
```

- Plain `setTimeout`/`clearTimeout` debounce, not an rxjs `Subject`+`debounceTime` — no typeahead
  in this codebase uses rxjs for this, and a plain timer needs no `OnDestroy` cleanup since it's
  harmless if it fires after the component's gone (the `subscribe` just updates a signal nobody
  reads anymore).
- **If an id arrives pre-selected** (a query param, a value carried over from another picker), the
  picker's `[options]` must be seeded with that one id's label via a direct lookup
  (`patientsApi.getById`) — otherwise `p-select` shows a blank/raw value until the user types a
  search, even though a valid selection is already bound.
- **When the entity you actually need (an admission) isn't independently searchable**, pick the
  entity that is (its patient) and derive the rest — Nursing's picker searches patients, then
  resolves the patient's one active admission via `GET /admissions?patientId=&status=Admitted`
  (the uniqueness of "one active admission per patient" is what makes this safe, not a general
  pattern). Don't build a second bespoke search index just to make the picker's `value` match the
  id an endpoint technically wants.

## 115. Two `EncountersApiService` files exist — check both when touching notes/diagnoses/prescriptions (2026-09-01)

`frontend/apps/staff-console/src/app/patients/encounters-api.service.ts` (used by
`patient-detail.ts`'s chart tabs) and `frontend/apps/staff-console/src/app/encounters/
encounters-api.service.ts` (used by the standalone `/clinical/encounters` screen,
`encounter-list.ts`) are two independent files with the same class name and near-identical
methods, wrapping the same `/encounters/*` backend routes. They drifted: the `patients/` copy was
fixed for the paginated-response bug during the "Edit Profile dialog does not open" incident; the
`encounters/` copy was not, and stayed broken (`@for` crashing on a `{data, meta}` object) until
found and fixed alongside the Sign & Lock work (`review-comments.md`, "No explicit sign-off/lock UI
on clinical notes"). **When you fix a bug or add a capability in one of these two files, check the
other one too** — they are not re-exports of each other, `grep -rn "encounters-api.service"
apps/staff-console/src` to find both call sites before assuming a fix is complete. This wasn't
consolidated into one shared service as part of this fix — that's a larger, deliberately deferred
follow-up (the two screens' `ClinicalNote`/`Diagnosis`/`Prescription` interfaces have small shape
differences, e.g. `appointmentId` presence, that would need reconciling first).

## 116. A UX gap that crosses a PRD role boundary: capture a note, don't grant the other role's permission (2026-09-01)

"No insurance/payer capture at patient registration intake" (`review-comments.md`) asked for a
Receptionist-facing prompt, but the PRD's role-scope table puts Insurance & Claims under
Billing/Accounts Staff, not Receptionist. Two ways to close a gap like this, and only one was
right here:

- **Wrong for this case**: grant Receptionist the permission needed to create the "real" record
  (`insurance.manage`, a `PatientPolicy` with payer/coverage/sum insured) — this hands her a whole
  module's write access (payer CRUD, claims, every policy in the tenant) just to solve "note the
  provider name at intake," and violates the PRD's explicit role split.
- **Right for this case**: add plain free-text columns to the record the asking role *already*
  manages (`patients.insuranceProvider`/`insurancePolicyNumber`, gated by the `patients.create`/
  `patients.update` permissions Receptionist already holds) — a quick note she can leave, not a
  formal transaction in the other role's domain. The owning role (Billing/Accounts Staff) turns it
  into the real record later via its own module, unprompted by this change.

Reach for this pattern whenever a finding's literal ask ("let X capture Y at the point of Z") would
otherwise require granting a permission the PRD deliberately didn't give that role — check the PRD
role-scope table first, and if the target module's real permission crosses the boundary, look for
a free-text/lightweight field on a record already in the asking role's scope instead of extending
permissions to reach it. (`PermissionGuard`/`@RequirePermission` also only supports one required
permission per route — no OR-of-permissions — so even a narrower new permission for just this one
action would mean a second endpoint or a guard change, more surface than a UX-only gap warrants.)

## 117. A net-new feature with no obvious module: reuse a sibling entity's permissions/scoping, and `p-paginator` emits `PaginatorState`, not `TableLazyLoadEvent` (2026-09-01)

"No shift-handoff notes feature" (`review-comments.md`) had no existing backend model to extend,
unlike most findings in this batch. Rather than standing up a new module + permission pair for one
small entity, `ShiftHandoffNote` was modeled as a sibling of `NursingTask`/
`MedicationAdministration` inside the existing Nursing module (migration `0098`): same
`nursing.manage`/`nursing.read` permissions, same `assertAdmissionExists`/
`assertWardAccessForAdmissionId`/`scopeToOwnWard` ward-scoping helpers, same controller/service
shape. Default to this — a new module/permission pair is only worth it when the entity doesn't
belong under any existing module's read/write boundary, not just because it's a new table.

On the frontend, the new "Shift Handoff" tab uses a `p-paginator` directly (card list, not a
`p-table`) instead of the Tasks/MAR tabs' `p-table` lazy-load pattern. The two are not
interchangeable: `p-table`'s `(onLazyLoad)` emits `TableLazyLoadEvent`, but `p-paginator`'s
`(onPageChange)` emits a differently-shaped `PaginatorState` (`{first, rows, page, pageCount}`).
Copying the lazy-load handler's type/name onto a paginator-only tab compiles-looking-plausible in
isolation but fails with `Type 'Event' has no properties in common with type 'TableLazyLoadEvent'`
plus missing-element/can't-bind diagnostics if `PaginatorModule` also isn't separately imported
into the component (`p-table`'s module doesn't include it). Use `PaginatorState` and
`PaginatorModule` for any card/list view paginated via a bare `p-paginator`, not the `p-table`
lazy-load types.

## 118. `@IsOptional()` skips `undefined`/`null`, not `''` — an optional form field with a format validator must be coerced to `undefined` before it reaches the API (2026-09-01)

Found live-verifying that family members can share one phone number (a common India registration
pattern): registering a second patient with a blank Date of Birth 400'd. `class-validator`'s
`@IsOptional()` only short-circuits the rest of a property's decorators when the value is
`undefined` or `null` — an empty string `''` still runs every validator after it. `CreatePatientDto`/
`UpdatePatientDto`'s `dateOfBirth`/`phoneNumber`/`email` each pair `@IsOptional()` with a format
validator (`@IsDateString`, `@Matches`, `@IsEmail` respectively), all of which reject `''`. Any
Angular form whose signal defaults one of these fields to `''` (not `undefined`) — or whose
`(ngModelChange)` sets it back to `''` when the user clears the input — sends that literal empty
string, not an absent field, and 400s.

A plain `@IsOptional() @IsString()` field (`allergies`, `governmentIdType`, middleName, etc.) is
unaffected — an empty string is a valid string, so it never surfaces this. The failure is specific
to `@IsOptional()` layered under a validator that rejects `''` on its own terms (date/email/regex
format checks, `@IsIn` with a fixed enum, `@IsUUID`, etc.). Before shipping a form for a DTO field
shaped like that, coerce the empty case explicitly at submit time (`field || undefined`) rather
than trusting `@IsOptional()` to absorb it — see `patient-list.ts`'s `submitRegistration()`/
`checkAndSubmit()` and `patient-detail.ts`'s `submitEdit()` for the pattern, and add a regression
test asserting the outgoing payload omits the field rather than sending `''`.

**Codebase-wide audit (2026-09-01):** swept all ~140 `@IsOptional()` fields paired with a
format-strict validator across every `*.dto.ts`, cross-referenced against every frontend form that
populates the matching field. Found only two more live instances beyond Patients — `email` on
`employee.dto.ts` (`employee-list.ts`) and `edd` on `create-maternity-record.dto.ts`
(`maternity-list.ts`), both fixed the same way (see `review-comments.md`'s entry right after the
Patient one). Everything else was either already guarded (this pattern is apparently well-
established across most screens already — Ward Supply, Purchase Orders, Users, Nursing, SSU,
Accounting all coerce correctly) or has no live frontend path to send `''` yet (numeric fields on
`p-inputNumber`, `p-select`-driven fields with no blank option, or DTOs with no create/edit UI
wired up at all). Re-run this sweep (grep every `*.dto.ts` for `@IsOptional()` followed by a
non-`@IsString`/`@IsBoolean`/`@IsArray`/`@IsObject` validator, then check the matching frontend
form's default/clear behavior) whenever a new optional date/email/enum/UUID field gets a create or
edit form — it's cheap to check at that point and expensive to rediscover live.

## 119. Patient search picker sweep completed (OT, Maternity, Vaccination); a create dialog needing an admission (not just a patient) resolves it from the patient selection

The "raw patient UUID" finding (`review-comments.md`) named two picker shapes to copy: SSU's
original search-box-plus-click-a-result-row, or Orders/Nursing's later server-searched `p-select`
(§114). Went with the `p-select` version for consistency with the most recent convention — a
debounced `(onFilter)` autocomplete dropdown is one component, not a separate search button plus a
result list, and it never offers a raw-UUID fallback (unlike SSU's original "or enter Patient ID
directly" escape hatch) since a hand-typed UUID is exactly the failure mode being closed.

A screen whose create dialog needs a real **admission**, not just a patient — Maternity's
`CreateMaternityRecordDto.admissionId` — layers one more step onto the patient picker rather than
adding a second picker for the admission: on patient selection, resolve their current active
admission via `AdmissionsApiService.list({ patientId, status: 'Admitted', page: 1, limit: 1 })`
(a patient can only have one active admission at a time, backend-enforced) and populate the form's
`admissionId` from the result, showing a read-only "resolved" context box (ward name via
`<hms-entity-name>`) instead of an editable admission field. Warn and leave it unresolved if the
patient has no active admission — matches `NursingConsole.onPatientSelected`
(`nursing-console.ts:171-204`), the pattern this mirrors; copy from there, not from a fresh
implementation, when another screen needs the same patient-to-admission resolution.

A component using `<hms-entity-name>` **anywhere in its template — including inside a `p-dialog`
that isn't currently visible** — needs a `DirectoryResolverService` mock provider in its spec, not
just an entity-bearing table row. `MaternityList`'s spec started failing with `NG0201: No provider
found for InjectionToken API_BASE_URL` on a test that never opened the create modal, because
Angular still constructs a `p-dialog`'s inner component tree even while `[(visible)]` is false —
only the CSS visibility is conditional, not instantiation. Add the mock provider whenever a new
`<hms-entity-name>` usage lands anywhere in a component's template, dialogs included.

## 120. A lazy-loaded `p-table`'s `load()` needs a `switchMap` trigger, not a plain `.subscribe` — and the two candidate fixes are not equivalent

"Paginator advances before the response lands" (`review-comments.md`) named two possible fixes:
move `firstRecord.set()` to the success handler, or route the request through an RxJS `switchMap`
cancellation stream. Went with `switchMap` — the other option only fixes the *visual* symptom
(paginator ahead of what's on screen), not the actual race: without cancellation, a slow response
to an old page/filter request can still land *after* a newer one and silently overwrite it, since
plain `.subscribe()` has no way to know a later request superseded it.

The pattern (see `ot-list.ts`, `maternity-list.ts`, `vaccination-list.ts`, `ssu-list.ts` for four
worked examples): `load()` itself just does `this.loadTrigger.next({ page, limit })` on a private
`Subject<{page,limit}>`; the actual `switchMap(...).subscribe(...)` pipeline is wired once in the
constructor (mirroring the `switchMap` pattern already used for route-param-driven loads in
`invoice-detail.ts`/`patient-detail.ts`, just triggered by a `Subject` instead of a route
`Observable`). Two details matter inside the pipeline:
- Set `firstRecord`/table signals **only inside the subscribe callback**, never before the request
  fires — otherwise a failed or superseded request still visually advances the paginator.
- `catchError` **inside** the inner `switchMap` callback, returning `EMPTY` — not a `.subscribe({
  error })` handler on the outer chain. An error handler on the outer subscription would terminate
  the whole `switchMap` pipeline on the first failed request, silently breaking every subsequent
  page click for the rest of the component's lifetime.

Test the actual race, not just the happy path: use a manually-controlled `Subject` per response
(not `of(...)`, which resolves synchronously and can never expose an ordering bug) so the test can
resolve a *later* trigger's response before an *earlier* one, and assert the earlier response is
silently discarded — see `ot-list.spec.ts`'s "does not let a slower earlier response overwrite a
later response that resolved first" for the exact shape. A component doing this for the first time
in its spec file may newly need `provideRouter([])` too, if a previously always-empty table now
renders rows containing a `routerLink`.

**Same pattern, second application (2026-09-02):** the deferred "cascading-select loads have no
request-ordering guard" finding (`review-comments.md`) was this exact shape one level down — a
category pick triggering a sub-category fetch, a sub-category pick triggering an item fetch, both
plain `.subscribe()` with no cancellation, across four files
(`inventory-item-list.ts`/`purchase-order-list.ts`/`stock-requisition-list.ts`/
`ward-supply-console.ts`). One addition worth carrying forward: route the *empty*-selection case
(user clears the `p-select`) through the same `switchMap` too, mapped to `EMPTY`, rather than
special-casing it before the `Subject.next()` call — a bare early-return on empty still lets a
stale in-flight request for the *previous* selection resolve after the clear and silently
repopulate a field the user just emptied. Routing every value (including `''`) through the
`switchMap` means `EMPTY` naturally cancels whatever was still in flight, the same way a new real
value would.

## 121. Duplicate a backend validation/scoring function client-side only when there's a real doc string to pin it to — and it's fine to ship untested-live when the only path to live data is seeding a whole workflow by hand

`lab-requisition-detail.ts`'s new `isValueAbnormal`/`isNumericComponent` duplicate the backend's
`computeIsAbnormal` (`lab-workflow.service.ts`) logic client-side, for entry-time feedback before
the round trip. This is a deliberate exception to "don't duplicate business logic" — the backend
function has a doc comment as of this fix explicitly describing what it does and why, so a future
change to the range-comparison rule has a fighting chance of being caught (a reviewer or the
function's own comment prompts "did the client copy need updating too?"). Don't reach for this
duplication pattern without that anchor — an undocumented backend function copied client-side just
for a UX nicety is exactly the kind of drift that goes unnoticed for years.

Also: this fix shipped without a live Playwright verification, unlike nearly everything else this
session. The demo tenant's lab catalog was empty (no categories/tests/components seeded) and no UI
anywhere creates a lab requisition (`POST /lab/requisitions` has no frontend caller at all — see the
still-open "no requisition creation" line of a different, already-resolved finding) — reaching the
Enter Results dialog live would have meant seeding a category → test → components → order →
requisition chain by direct API calls, disproportionate effort for a low-risk, additive,
frontend-only UI change (not money, not tenant isolation, not a clinical sign-off gate). Component
tests asserting the exact same values the backend's algorithm would independently classify
(in-range, above-range, below-range, qualitative) are the right-sized substitute here — reach for
live verification when it's cheap relative to the change's risk, not as a uniform ritual regardless
of cost.

## 122. `noEmitOnError` + `composite` + `emitDeclarationOnly`: one unrelated diagnostic anywhere in a project silently blocks `.d.ts` emission for the *whole* project

Root-caused the long-open "from-scratch `tsc --build` produces ~3,000 false errors" finding
(`review-comments.md`). `tsconfig.base.json` sets `noEmitOnError: true` alongside `composite: true`
and `emitDeclarationOnly: true`. Under that combination, `tsc --build` on `apps/api` treats the
project as all-or-nothing: if *any* file has a TS diagnostic — even something as trivial as an
unused import (`TS6133`) in one DTO nobody was touching — the compiler reports that one error and
then emits **zero** `.d.ts` files for the entire project, not just skips the offending file. Every
other project that references this one via TS project references (here, `tsconfig.spec.json`,
which resolves `tsconfig.app.json`'s types via its emitted declarations, not raw source) then sees
those types as absent, and TypeScript's generic inference silently falls back to `unknown` at every
call site depending on them — in this repo, every `ctx.inTenant(() => service.method())` in every
`*.integration-spec.ts` file, since `inTenant<T>`'s `T` infers from `service.method()`'s return
type. The result reads exactly like a project-references ordering bug or a task-parallelism race —
it is neither. Confirmed by isolating a single bare `tsc --build tsconfig.app.json
--emitDeclarationOnly` (no Nx, no other process running) from a genuinely clean state: it reported
one trivial diagnostic and produced a `dist/` containing only a `.tsbuildinfo`, no `.d.ts` files at
all.

Two practical takeaways. First, when reproducing a "clean build" issue in this workspace, clean
*everything* the graph touches — `apps/api/dist`+`out-tsc` alone is not clean; every one of the 7
referenced libs (`libs/*/dist`, `libs/*/out-tsc`) and the root `tsconfig.tsbuildinfo` carry their
own incremental state too, and a stale-but-present library `.d.ts` from an earlier,
differently-shaped build can mask exactly this kind of bug (which is presumably why this one went
undiagnosed for as long as it did). Second, this means a single unrelated lint-level TS error
(unused import, unused variable) anywhere in `apps/api` is not merely cosmetic — under this
tsconfig combination it's load-bearing for every downstream project's ability to typecheck at all
from a cold cache. Treat any `TS6133`/similar in `apps/api` as urgent to clear, not a "get to it
eventually" item, and if CI ever runs on a genuinely cold cache (a fresh runner, a cache-busting
dependency bump), this is exactly the failure mode that would silently pass on every warm-cache
local machine and only surface there.

## 123. A demo/dev seed script's reference data needs its own idempotency gate, separate from its business-data gate

`seed-demo-data.ts` originally gated its entire body — catalog data (wards, lab/radiology/inventory
catalogs) and business data (patients, orders, an admission) alike — behind one check: "does the
tenant have any patients yet?" That meant catalog seeding could never be re-run once a single
patient existed for any reason (manual testing, a partial prior seed run), which is exactly why the
demo tenant's lab catalog was empty going into this fix despite the seeder covering it — the
underlying cause of the earlier "lab result entry" fix (§121) shipping without live verification.

Split into `seedCatalogData()` — checked per-entry against its own natural key (a ward's
`wardCode`, a lab test's `code`, a payer's `name` where there's no code) — called unconditionally,
and wired to its own `nx run api:seed-demo-catalog` target, separate from `seed-demo-data`'s
existing patient-count gate. The general rule for any seed script mixing reference/catalog data
with transactional/business data: catalog data should almost always get its own idempotency check
and be safe to run standalone, since it's the kind of data other engineers reach for constantly
(to unblock a screen, populate a picker, reproduce a bug) independent of whatever transactional
state the tenant happens to be in — a single shared "have we seeded at all" gate silently blocks
re-running just the part that's actually needed.

## 124. Reconciling two divergent API-service copies: check both against the real backend entity, don't just pick a winner

Collapsed `patients/vitals-api.service.ts` + `vitals/vitals-api.service.ts` into one, and the same
for `encounters/`. Both copies were wrong in different, complementary ways — one had the fuller
field set but non-null-optional typing on columns that are actually nullable; the other had correct
nullable typing but had silently dropped real fields (`appointmentId`, `updatedAt`,
`Prescription.status`). Diffing the two files against each other doesn't tell you which one to
trust; check both against the backend entity (`@Column({ nullable: true })` means the field really
can be `null`, not just "optional" — TypeORM returns `null` for an unset nullable column, not an
omitted key, so `field?: T` typing is actively wrong there, not just imprecise) and merge the
correct parts of each, don't pick a wholesale winner.

Before deleting either copy, grep the whole app for every call site of every method on the class
being removed — don't assume a method is dead just because it looks unused from reading the one
file. `patients/vitals-api.service.ts`'s `update()`/`void()` genuinely had zero callers (confirmed,
not assumed) and were kept anyway, renamed only (`void` → `voidVital`, avoiding the reserved-word
collision) — they're real, backend-backed endpoints a future screen may need, and "duplicate
cleanup" isn't licence to also delete working-but-currently-unused functionality.

When the canonical file already has an HTTP-level `HttpTestingController` spec and the copy being
deleted also does, move the deleted copy's spec to the canonical location rather than discarding it
— don't leave the merged service with only the thinner of the two test files' coverage.

## 125. Never chain a non-idempotent mutation's success into a refetch inside the same `.subscribe()` error branch

Adding Cancel Invoice/Record Return to `invoice-detail.ts`, the original shape (matching the
pre-existing Record Payment code it was modelled on) was:

```ts
this.invoicesApi.createReturn(id, dto)
  .pipe(switchMap(() => this.invoicesApi.findOne(id)))
  .subscribe({ next: (updated) => {...}, error: (err) => this.returnError.set(err.message) });
```

A `switchMap` chain collapses two different failure domains into one `error` handler: "the mutation
itself failed" (nothing happened, safe to retry) and "the mutation succeeded but the follow-up
`findOne()` failed" (money already moved server-side, retrying re-applies it). A code review of this
change (run at high effort per this repo's Billing risk gate) caught that the second case reports a
successful action as failed, and — because `InvoicesService.createReturn` has no idempotency key —
a user retrying what they believe was a failed partial return applies it a second time (100 paid,
return 40 succeeds, refetch 5xxs, "failed" shown, retry succeeds again → 80 refunded against 100
collected). `cancel` happens to be retry-safe (the backend rejects a second cancel with a 409,
"already cancelled") but still showed a false failure on the same refetch-error path.

The fix: treat the mutation's own success as terminal — close the modal and toast success as soon
as the mutation itself resolves — then run the refresh as a separate, independently-erroring
subscription that only surfaces a "reload to see the latest" warning:

```ts
this.invoicesApi.createReturn(id, dto).subscribe({
  next: () => { /* toast success, close modal */ this.refreshInvoice(id); },
  error: (err) => this.returnError.set(err.message),
});

private refreshInvoice(id: string): void {
  this.invoicesApi.findOne(id).subscribe({
    next: (updated) => { if (this.invoice()?.id === id) this.invoice.set(updated); },
    error: () => this.messageService.add({ severity: 'warn', summary: 'Refresh needed', ... }),
  });
}
```

Applies to any screen chaining a POST/PATCH mutation into a GET refetch via `switchMap` +
one `.subscribe()` — check whether the mutation is idempotent server-side before deciding a
collapsed error branch is safe. If it isn't (no unique constraint, no idempotency key, and a retry
would apply the action again), split the two calls. The `this.invoice()?.id === id` guard in
`refreshInvoice` also protects against a route change landing mid-flight: without it, a late
refresh response for the previous invoice could overwrite whatever the `paramMap` subscription has
since loaded for a new one.

## 126. A UI-display-only claim in the JWT is a real design choice, not a free add — and check the frontend's own base64 decoder before adding a non-ASCII value to any claim

Adding `displayName` to the access token (`AuthService.buildAccessPayload`) so the shell header
could show a real name instead of `roles[0]`-derived initials, a review of the diff (run at high
effort — this touches auth) raised two points worth keeping as defaults for the next "just for
display" claim:

- **Scope it to the account types that actually consume it.** `displayName` is staff-only, not
  `accountType === 'patient'` too, even though `Account.displayName` is populated for both. A
  patient token carrying the patient's real name would newly assert "this named individual is a
  patient at hospital X" in a readable (base64, not encrypted — anyone holding the token can read
  every claim) blob, a stronger disclosure than the existing opaque `sub`/`patientId` claims — and
  nothing in `apps/patient-portal` (no source files exist yet) consumes it. Don't ship an exposure
  for a consumer that doesn't exist; gate a new UI-only claim by account type if any account type
  has no use for it.
- **A signed, non-revocable, sent-on-every-request credential is the wrong place for anything that
  can change and needs to be corrected promptly.** A renamed account won't show the new name until
  the 15-minute access token naturally expires, with no way to force it. `displayName` was judged
  worth that tradeoff (low-stakes, cosmetic, already-short TTL) — but it's a real one, and the
  alternative (`GET /accounts/me`, cached in `AuthService` at session start) is worth reaching for
  once a *second* "just for display" field wants added (email, avatar URL, department), not
  waiting until the JWT is bloated with several of them.

Separately, and specific to any claim carrying real human names in an India-market EMR:
`decodeAccessToken` (`libs/auth/src/lib/decode-access-token.ts`) decoded the JWT payload with
`atob()` alone, which yields a Latin-1 binary string, while the backend signs UTF-8 bytes
(`jsonwebtoken` → `Buffer.from(JSON.stringify(payload))`). Every claim before `displayName` was
ASCII in practice (UUIDs, tenant slugs, seeded English role/permission names), so this was a live
bug with zero test coverage until the first claim that routinely isn't ASCII landed — "डॉ. रमेश"
decoded to Latin-1-per-byte mojibake, corrupting the exact header the fix was adding. Fixed via
`new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)))`. Any new frontend code
that decodes a JWT payload directly (rather than going through this shared helper) needs the same
fix — `atob()` is not a safe UTF-8-string decoder on its own.

## 127. Run `nx lint` before considering a frontend item done, not just at audit time — and a third-party generic type in a signal needs an explicit annotation to declaration-emit cleanly

`nx lint staff-console` had never actually been run as part of this pipeline's per-item checklist
— `frontend/.github/workflows/ci.yml` does run `lint test build typecheck e2e` via
`nx run-many`, but this session routinely sat on 5+ unpushed local commits at a time, so CI never
saw (or caught) any of it. A 2026-09-02 audit ran it cold and found 21 problems across 15 files —
most pre-existing, but two were a same-day regression (a `<label for="...">` left dangling after
its paired `<input>` was converted to a read-only `<div>` earlier the same session). Add `nx lint`
to the fast-track checklist (alongside test/typecheck) for any frontend item touching a
`.html`/`.ts` file, the same way `tsc --build` already is — it would have caught the regression in
the same commit that introduced it instead of a separate audit three commits later.

Two reusable fixes from that cleanup, worth keeping as the default pattern:
- **A `<label>` wrapping a PrimeNG custom element** (`p-select`, `p-checkbox`, `p-toggleswitch`,
  …) is not credited as "associated" by `@angular-eslint/template/label-has-associated-control`
  even when the control is a genuine nested interactive element — the rule only recognizes native
  form elements via wrapping. Give the PrimeNG component an `inputId` (a dynamic one inside a
  `@for` needs `[inputId]="'prefix-' + item.id"`, paired with `[attr.for]` on the label, not a
  plain `for`) and keep the wrap; don't reach for `tabindex`/ARIA workarounds. A `<label>` with no
  real control behind it at all (a plain section heading) should just be a `<span>`/`<div>`
  instead — it was never actually labelling anything.
- **A third-party library's deeply generic type inferred into a `signal<T>()` can fail to
  declaration-emit** (`TS2883: The inferred type ... cannot be named without a reference to
  '_DeepPartialObject' ... This is likely not portable`) under this project's
  `composite`/`emitDeclarationOnly` tsconfig (§122's same family of gotcha, different trigger).
  Chart.js's `ChartOptions<'bar'>` inside a signal hit this. The type argument on `signal<T>()`
  itself doesn't fix it — TypeScript still has to *infer* the property's own type for the
  declaration file. Give the property itself an explicit type annotation instead
  (`readonly x: WritableSignal<ChartOptions<'bar'>> = signal({...})`) so the declaration emitter
  has a name to write out rather than needing to spell the inferred structural type.

## 128. A screen two permissions both need reachable, but for different things, needs `permissionGuard` OR semantics — and each UI affordance still gates on its own permission, not the route's

`permissionGuard(permission: string)` only ever supported a single required permission. That's
fine when one permission gates the whole screen, but breaks when a screen serves two audiences
who need it for different reasons and hold different permissions for those reasons — Helpdesk:
most staff roles hold `helpdesk.create` (raise a ticket) but not `helpdesk.read` (browse everyone
else's), while Helpdesk Agent/Hospital Admin/Super Admin hold `helpdesk.read`/`helpdesk.manage`
but — found live in the same pass — Helpdesk Agent does *not* hold `helpdesk.create`. Route-level
gating on `helpdesk.read` alone made `/helpdesk` unreachable for the create-only majority; gating
the New Ticket button and the ticket list/filters on that same single route-level permission (the
easy mistake) would have made the button 403 for Helpdesk Agent and the list 403 for everyone
else. Fixed two ways:

- `permissionGuard` now accepts `string | string[]`, checked with OR semantics
  (`permissions.some(p => hasPermission(p))`) — backward compatible, since a bare string
  normalizes to a one-element array. Use the array form only when a route is genuinely reachable
  for more than one reason; a route still gated by exactly one permission keeps passing a string.
- Inside the component, each UI affordance gates on the *specific* permission it needs
  (`canRead` for the list/filters/reload-after-create, `canCreate` for the New Ticket button), not
  on "whichever permission got me onto this route." A component reachable via an OR'd route guard
  should assume neither permission alone, and check both independently — a non-discriminating test
  stub (`hasPermission: () => bool`) can't catch a mistake here, since it can't tell "checks the
  right permission" apart from "checks nothing at all"; give the stub `(p: string) => p === '...'`
  so it actually distinguishes.

## 129. Printable labels: a custom pdfmake pageSize, built-in QR (no barcode dependency), and the frontend's first binary download

Building the patient ID label (`patient-id-label-document.ts`, `PatientsService.renderIdLabelPdf`)
established three things every future label (Lab/Radiology specimen, Pharmacy dispensing —
`pending-tasks.md`'s Document & Print entry) can reuse directly:

- **A label is not a report page.** `PdfDocumentDefinition.pageSize` takes `{ width, height }` in
  points (72pt/in) — a 4in x 2in pre-cut label is `{ width: 288, height: 144 }`, with small margins
  (`pageMargins: [10, 10, 10, 10]`). Every prior `@hospital/pdf` consumer (Lab/Radiology reports,
  Reporting exports) implicitly defaults to A4; a label needs this set explicitly or pdfmake
  renders it as a full A4 page with the label content stranded in one corner.
- **pdfmake has built-in QR support** (`{ qr: 'content', fit: 100 }`) — no barcode library needed
  for a scan-to-look-up use case. Encode whatever value the app actually looks records up by
  (here, `patientId` — every screen's `routerLink`/API call already keys off it), not a
  human-friendly number printed as text alongside it for staff to read.
- **`ApiClientService.getBlob()`** (new, additive — `get<T>()` unaffected) is this frontend's first
  binary-download method: `responseType: 'blob'`, same tenant-header/error-handling as `get()`.
  **`shared/pdf-blob.util.ts`'s `openPdfBlobInNewTab()`** (extracted 2026-09-02 once three screens
  — Patient Detail, Lab Requisition Detail, Radiology Requisition Detail — needed it) opens the
  blob via `URL.createObjectURL()` + `window.open(url, '_blank')` rather than forcing a
  `<a download>` — the point is printing (Ctrl+P in the browser's own PDF viewer), not saving a
  file. Revoke the object URL after a short delay (10s), not immediately — revoking synchronously
  can race the new tab's own fetch of the blob URL on some browsers.

**Also found while building this, not fixed:** Lab/Radiology's `report.pdf` and Reporting's
CSV/PDF export endpoints (all shipped earlier sessions) have no frontend button anywhere calling
them — confirmed via `grep -rli pdf src/app` returning nothing before this item. Pre-existing gap,
out of scope here, but the fix is now a known one-line addition using this same `getBlob()` +
`window.open()` pattern once picked up as its own item.

## 130. A raw-UUID sweep needs a broader grep than the one that found the original bug, and "no name to resolve" needs its own fix shape

After fixing `EntityName`'s own display bug (§113's correction note), a follow-up sweep asked to
visit every screen/role and eliminate remaining raw-UUID displays — found 9 more, not caught by
the original component-level fix because they never went through `EntityName` at all (a bare
`{{ x.someId }}` interpolation, or a raw id used as link text/page title). Two lessons:

- **The find-them grep needs to catch an id-suffixed property anywhere inside an interpolation,
  not just as its sole content.** `\{\{\s*[a-zA-Z_.]*[Ii]d\s*\}\}` (matches only `{{ x.fooId }}`)
  missed `{{ x.fooId || 'N/A' }}` and `{{ x.fooId.slice(0, 8) }}`, both of which unconditionally
  show a raw id text. The broader `\{\{[^}]*\.[a-zA-Z_]*[Ii]d[^}]*\}\}` catches both, but also
  surfaces already-correct fallback patterns (`resolvedName() ?? entity.someId`, matching
  `EntityName`'s own now-fixed behavior) — those aren't bugs, don't touch them.
- **Not every raw id has a name to resolve.** Six new directory types (`orderItem`, `test`,
  `imagingItem`, `invoice`, `employee`, `department`) covered most finds directly. The rest —
  Order Detail's own id in its page title, and its `sourceAppointmentId`/`sourceAdmissionId`;
  Maternity's admission link text — reference entities with no single human-readable name at all
  (an Order or an Admission doesn't have one). The fix there isn't resolution, it's removing the
  id from display entirely: drop it from the title, or turn it into a plain "View X" navigation
  link (matching the pattern the Patient Record card on the same screen already used) — the id was
  never meaningful to a reader, only to the link's `routerLink` target.

**A third shape, found on Reporting Dashboard and Audit Trail:** neither screen's own raw id
(`entityId`, `recordId`) is a directly resolvable reference — both are bare table PKs (an Order, a
Payment, a journal entry row) with no name of their own. But both screens already carry enough
context to do better than a raw id:
- Reporting: `ReportingEvent.payload` already carries a patient/invoice/bed reference (built by
  `ReportingSubscriber.buildPayload` at publish time) — `reportingEventSubjectRef(event)` maps
  `eventType` to the right payload field and directory type, resolving that instead. Falls back to
  the raw `entityId` for an event type it doesn't recognize.
- Audit: `AuditRecord.recordId` **is** the referenced entity's own PK in `record.tableName` — no
  payload-drilling needed, just a `tableName -> DirectoryEntityType` map
  (`auditRecordDirectoryType()`). Audit records span far more tables than the directory resolver
  covers (journal entries, helpdesk tickets, tenants, …), so this is a deliberately bounded,
  partial win — falls back to the raw id for an unmapped table, not full audit-log entity
  resolution (a materially bigger feature, not attempted here).

**Correction (2026-09-02):** `tsc --build apps/staff-console/tsconfig.app.json` — this session's
own verification step for every frontend change — does **not** type-check Angular templates; it
only checks the `.ts` files. Binding an optional-chained value (`targetCase()?.patientId`, typed
`string | undefined`) to `<hms-entity-name [id]="...">`'s required `string` input compiled clean
under `tsc --build` and broke only at `nx build` (Angular's real AOT compiler, which does
type-check templates) — caught after the fact, from a real CI/build failure, not this session's
own checks. `tsc --build` stays the fast day-to-day check; run `nx build <app>` too before calling
a change done whenever it touches a template property binding (`[x]="..."`), not just plain
interpolation (`{{ x }}`) — interpolation coerces to string and is far more forgiving.

## 131. Closing "no export button" gaps: a new `@hospital/excel` platform lib, and keeping an export service off a constructor eight other specs build directly

Closing §129's "found, not fixed" note (Lab/Radiology `report.pdf`, Reporting CSV/PDF export — no
frontend button) plus adding Excel export end to end (Reporting events/revenue, and the
previously-export-less Accounting reports) established the third `@hospital/pdf`-shaped platform
lib and a service-boundary pattern worth reusing:

- **`@hospital/excel`** (new lib, `exceljs`-backed) mirrors `@hospital/pdf`'s "thin renderer, caller
  owns the content" split exactly: `ExcelService.renderWorkbook(sheets)` takes
  `{ name, columns: { header, key, width? }[], rows: Record<string, ...>[] }[]` and returns a
  `Buffer`; no report-specific logic lives in the lib itself. Scaffolded by hand (package.json,
  tsconfig.json/.lib.json/.spec.json, jest.config.cts, `.spec.swcrc`) copied file-for-file from
  `libs/pdf`, then `nx sync` to add the project reference to the root `tsconfig.json` — the
  `guard-config.sh` hook that blocks `Edit`/`Write` on `tsconfig*.json` did **not** block creating
  new ones for this lib, only (per its own doc comment) edits to already-committed ones; `nx sync`
  itself is the sanctioned way to add the reference this generator step would otherwise need.
- **exceljs's own `Buffer` type doesn't structurally match this workspace's `@types/node` `Buffer`
  generic** (`Buffer<ArrayBufferLike>` vs whatever exceljs's bundled types declare) — a plain
  `as unknown as Buffer` cast still fails at the call site, because the mismatch is between the
  cast's *result* type and the parameter's own type, not bypassed by the cast itself. Fix:
  `as unknown as Parameters<typeof workbook.xlsx.load>[0]` — pull the exact expected type from the
  function being called instead of guessing a cast target.
- **CSV serialization has no shared platform lib** (`reporting-csv.util.ts`'s `toCsv`/
  `escapeCsvField`) — duplicated into `accounting-csv.util.ts` rather than promoted, since a
  cross-domain import (`domain:accounting` → `domain:reporting`) would need an `eslint.config.mjs`
  boundary edge, and that file is under the same `guard-config.sh` protection with no sanctioned
  sync-tool workaround the way tsconfig has. Two small pure functions duplicated once is cheaper
  than either an eslint-config edit blocked on human sign-off or promoting a two-function util to a
  new platform lib for it alone.
- **`toCsv`/`ExcelSheet.rows` take `Record<string, unknown>[]`, but a TypeORM entity/interface
  return type (`TrialBalanceRow[]`, etc.) has no index signature** — passing it straight through is
  a real `TS2345`, not a false positive; TypeScript's index-signature compatibility check applies to
  named interface types even though the values are structurally identical. Fix: spread into a fresh
  object literal at the call site (`rows.map((r) => ({ ...r }))`) — a literal satisfies the
  index-signature check where the named type doesn't, even though nothing about the runtime shape
  changed.
- **An export service for an existing domain service is worth splitting out, not bolting onto the
  original constructor, once that constructor is built directly (not through Nest DI) by other
  modules' specs.** `AccountingService` is `new`'d directly in eight files across `accounting`,
  `fixed-assets`, `patient-portal`, `payroll`, `fraction`, `insurance`, and `billing`'s integration
  specs (same pattern `ReportingQueryService` avoided from the start by never taking
  `PdfService`/`ExcelService` any other way). Adding export dependencies there would have forced a
  signature-compatible constructor-arg change through every one of those unrelated files for a
  concern only the reports care about. `AccountingExportService(accountingService, pdfService,
  excelService)` instead depends on `AccountingService` as a normal injected collaborator and calls
  its already-public `trialBalance()`/`incomeStatement()`/`balanceSheet()` methods — zero changes to
  `AccountingService` itself or any file that constructs it.
- **Frontend: a forced download needs a different helper than `openPdfBlobInNewTab()`.** CSV/Excel
  exports (and Reporting's own `export.pdf`, since the backend sends it `Content-Disposition:
  attachment` rather than `inline`) are meant to be saved, not viewed in-browser — `shared/
  download-blob.util.ts`'s `downloadBlob(blob, filename)` creates a hidden `<a download>`, clicks
  it, and revokes the object URL immediately (no race to guard against, unlike the new-tab case —
  nothing else reads the blob URL after the synchronous click). Route each export by what the
  backend's own `Content-Disposition` says: `attachment` → `downloadBlob()`, `inline` →
  `openPdfBlobInNewTab()`.
- **Testing a component that both renders via `TestBed.createComponent`/`fixture.detectChanges()`
  and calls `document.createElement('a')` for a forced download needs a *scoped* spy, not a global
  mock return value.** `jest.spyOn(document, 'createElement').mockReturnValue(fakeAnchor)`
  intercepts every element Angular's own renderer creates too (`insertRootElement` et al.), breaking
  `fixture.detectChanges()` outright. Scope it: check the tag argument, return the fake anchor only
  for `'a'`, delegate every other tag to the real `document.createElement.bind(document)` captured
  before the spy replaces it.

## 132. A second `TypeORM afterInsert` subscriber taking a second pooled connection needs its own dedicated pool too, not just the first one

An external review (2026-09-03) flagged connection-pool starvation risk in `PersistingAuditEventPublisher`
and `ReportingSubscriber`'s publisher as if it were one undifferentiated problem. It wasn't: the
reporting side was already fixed this way (`REPORTING_DATA_SOURCE`, a dedicated bounded pool — see
`reporting-data-source.ts`) precisely because of this failure mode, but `PersistingAuditEventPublisher`
still called `runInTenantSchema()` with no override, taking its second connection from the *same*
main pool (`DB_POOL_MAX`, default 20) a live business transaction was still holding. Under enough
concurrent write load — every `.save()` on an audited entity fires this — that starves the pool:
node-postgres defaults to `connectionTimeoutMillis: 0` (wait indefinitely), so exhaustion doesn't
error, it just hangs every in-flight request until `DB_STATEMENT_TIMEOUT_MS` eventually trips.

Fix mirrored the reporting pattern exactly rather than inventing a new one: `audit-data-source.ts`'s
`createAuditDataSource()` builds a second `DataSource` mapping only `AuditRecord`, capped at
`max: 3` with `connectionTimeoutMillis: 2000` (short and bounded on purpose — an audit write is
best-effort, so failing fast beats an unbounded wait); `AuditModule` provides it via an async
factory under an `AUDIT_DATA_SOURCE` DI token and tears it down in `onModuleDestroy`;
`PersistingAuditEventPublisher` takes it as a constructor dependency and passes it as
`runInTenantSchema`'s second argument (`dataSourceOverride`) instead of relying on the default.

Two things worth generalizing for the *next* subscriber that fires `runInTenantSchema` off a TypeORM
hook: (1) grep for existing dedicated-pool tokens (`REPORTING_DATA_SOURCE`, `AUDIT_DATA_SOURCE`)
before assuming the main pool is fine — a hook firing on every write of some entity is exactly the
shape that causes this; (2) a publisher that's directly `new`'d in a lightweight integration spec
(not resolved through Nest DI) needs the spec updated to construct and initialize its own throwaway
copy of the dedicated `DataSource` too — `persisting-audit-event-publisher.integration-spec.ts` now
creates and destroys its own `createAuditDataSource()` instance in `beforeAll`/`afterAll`, matching
what the reporting spec already did via full `AppModule` bootstrap + `app.get(REPORTING_DATA_SOURCE)`.
Pin the routing itself, not just that the write succeeds: a `jest.spyOn(tenantConnection,
'runInTenantSchema')` assertion that the dedicated `DataSource` was actually passed as the second
argument is the only thing that would catch a future edit silently dropping it and reintroducing the
starvation risk — every other test in both files exercises the publisher without checking which pool
served the write, so all of them stay green even if that argument is deleted.

## 133. Fixing a bug inside an immutable squashed migration baseline needs a new migration and a fresh sort-key block, not an edit

`0093-initial-platform-schema.ts` (the platform baseline from the 2026-08-27 squash, §108) carries
a self-contradicting pg_dump artifact: `REVOKE USAGE ON SCHEMA public FROM PUBLIC; GRANT ALL ON
SCHEMA public TO PUBLIC;` — the second statement immediately undoes the first and grants `CREATE`
on top, so every tenant Postgres role (`PUBLIC` covers all of them) could `CREATE TABLE`/`FUNCTION`
directly in the shared `public` schema. The file is explicitly documented "APPEND-ONLY / IMMUTABLE:
never edit it" and a `PreToolUse` hook blocks direct edits to already-committed migrations anyway
(see the `migration-safety-check` skill) — so the fix is a **new** migration,
`0099-restrict-public-schema-grants.ts`, not a change to 0093 itself.

Two things worth generalizing:

- **A new migration in an array that currently holds only its squashed baseline needs its own
  fresh sort-key block prefix, not the existing one.** `index.spec.ts` checks sort-key uniqueness
  *across both arrays combined* (`[...PLATFORM_MIGRATIONS, ...TENANT_MIGRATIONS]`), and the tenant
  side already claimed the "3-prefix" block (`AddPatientAllergies3000000000001` etc. — §95-98).
  `RestrictPublicSchemaGrants4000000000001` starts a "4-prefix" block instead — first platform
  migration since the squash, so any prefix distinct from `1...093` (the old baseline) and
  `3...xxx` (tenant's modern block) would satisfy the ascending-order check trivially (a
  single-element "modern" slice for `PLATFORM_MIGRATIONS`), but picking a genuinely new block
  keeps the numbering legible as "which squash-era generation this migration belongs to" rather
  than interleaving two unrelated features' counters.
- **`GRANT`/`REVOKE ... TO/FROM PUBLIC` is a pseudo-role, not a role name** — it applies to every
  Postgres role including ones created after the migration runs, so a schema-level ACL fix like
  this needs no per-tenant backfill loop the way a tenant-scoped *table* migration would (compare
  `migration-safety-check`'s guidance on `TENANT_MIGRATIONS`/`migrate-tenants.ts` replay, which
  doesn't apply here precisely because this isn't a tenant-schema change). Verified live via
  `\dn+ public` (ACL went from `=UC/pg_database_owner` to `=U/pg_database_owner` — USAGE only) and
  via two new integration tests against a real provisioned tenant role in
  `tenant-connection.service.integration-spec.ts`: `CREATE TABLE public.x` now fails with
  `permission denied for schema`, while `SELECT gen_random_uuid()` (what every tenant table's
  `id uuid DEFAULT gen_random_uuid()` depends on via the `search_path` fallback to `public`) still
  succeeds — proving the fix revoked `CREATE` without over-correcting into revoking `USAGE` too.
