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

