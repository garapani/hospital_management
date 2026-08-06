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
`inventory.dispatch.fulfill`) — both new first-ever permission grants for Inventory/Store Manager
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
but guards against a future refactor silently breaking that guarantee.

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

**With Item A and Item B both shipped, the Inventory module is complete** for the scope this pipeline
was designed to cover — catalog, procurement (stock IN), and requisition/dispatch (stock OUT) all
exist and are wired together through the shared `stock_balances`/`stock_batches` tables. Pharmacy,
the next Phase 6 item, can now build against a working stock pipeline instead of stubbing one.

See `new/docs/superpowers/plans/2026-08-06-inventory-requisition-dispatch.md` for the full
implementation history.
