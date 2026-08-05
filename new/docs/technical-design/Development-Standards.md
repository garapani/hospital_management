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
(`tenant_<hospitalId>` for both). The app's single DB role (`identity_access`) is granted
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
`identity_access` membership in the new role. Both `TenantsService.provisionTenant()` and the test
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

See `new/docs/superpowers/plans/2026-08-05-radiology-module.md` for the full implementation
history.
