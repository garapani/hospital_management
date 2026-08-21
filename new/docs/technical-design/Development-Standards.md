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
