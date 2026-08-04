# Database-Enforced Tenant Isolation — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 1 item 3 (`new-features.md` #2)

## Problem

The PRD already states the intended design — "tenant isolation enforced with Postgres role-level
schema grants (a tenant's DB role can only reference its own schema)" (`PRD.md:240`, `:316`) — but
none of it is implemented. Every request, regardless of tenant, uses the same single Postgres role
(`identity_access`) with standing access to every schema; isolation is enforced only by
`TenantConnectionService.runInTenantSchema()` issuing `SET search_path` on that one shared role.
If application code ever sets the wrong tenant context — a real bug class, not hypothetical — the
database has no independent mechanism to refuse the query. Existing "isolation" tests
(`cross-tenant-login.integration-spec.ts` and others under the `tenant-test-context.ts` harness)
only prove the app's own routing is correct; they cannot detect this failure mode, because the
underlying DB role never lacked access in the first place.

Investigation surfaced this item is larger than "add GRANT statements":

- **No real production tenant-provisioning path exists.** `TenantsService.provisionTenant()`
  (`apps/api/src/tenants/tenants.service.ts:17-38`) only inserts a row into the `tenants` registry
  table. The actual `CREATE SCHEMA` + migration-replay logic lives only in
  `AccountsService.provisionTenantSchema()` (`apps/api/src/accounts/accounts.service.ts:50-95`),
  explicitly commented as a *"Test/dev-only stand-in for the deferred `tenant.provisioned` event
  consumer"* — its only caller in the whole codebase is the test helper
  `apps/api/src/testing/tenant-test-context.ts`.
- **The tenant-migration-runner gap** named in `pending-tasks.md`'s Dependencies section is
  confirmed real: `apps/api/src/database/migrate.ts` runs `dataSource.runMigrations()` once,
  against whatever schema the connection defaults to — nothing iterates already-provisioned tenant
  schemas, for any of the 17 migrations that exist today.
- **`data-source.ts`'s `migrations` array is missing 6 of the 17 migration files** (`0002`, `0004`,
  `0006`, `0007`, `0009`, `0011`) — a pre-existing bug independent of tenant isolation, meaning
  several tables silently never get created via `migrate.ts`. Fixed here because the formal
  platform-vs-tenant migration split this feature needs is the same fix.

## Decisions

**Enforcement model: per-tenant Postgres roles + schema grants**, not the documented
single-role-plus-app-checks alternative. A shared role can never satisfy new-features.md's own
stated test requirement ("prove isolation even if the application sets the wrong tenant context"),
since a shared role always has standing DB access to every schema regardless of what the app does.

**Role-switching: `SET LOCAL ROLE` within the existing single connection pool**, not per-tenant
connection pools. `identity_access` remains the one role the app's `DataSource` authenticates as;
it becomes a member of every tenant role (`GRANT tenant_<id> TO identity_access`, membership only —
tenant roles are `NOLOGIN`, no separate credential to manage). `TenantConnectionService.runInTenantSchema()`
issues `SET LOCAL ROLE tenant_<id>` alongside its existing `SET search_path` call — `LOCAL` scopes
the role switch to the current transaction, auto-resetting when it ends, so a connection returned
to the pool never leaks an elevated role into the next request. Per-tenant connection pools were
rejected: architecturally purer, but N pools to create/credential/manage at this project's
confirmed 10-20 tenant scale contradicts its repeated, explicit preference for operational
simplicity (the same reasoning that drove the earlier microservices→modular-monolith pivot).

**Grant durability: `ALTER DEFAULT PRIVILEGES`, not per-migration `GRANT` statements.** Set once
per tenant role at provisioning time (`ALTER DEFAULT PRIVILEGES IN SCHEMA tenant_<id> GRANT ALL ON
TABLES TO tenant_<id>`, and the equivalent for sequences). Every future migration's new tables
automatically inherit the correct grant — satisfies new-features.md's "migrations must preserve
grants" requirement by construction, not by relying on every future migration author remembering
an extra `GRANT` line.

**Real tenant provisioning: promote the test-only logic into one shared service**, not two
separately-maintained implementations. A new `TenantProvisioningService`
(`apps/api/src/database/tenant-provisioning.service.ts`) owns: validate `hospitalId` →
`CREATE SCHEMA` → `CREATE ROLE tenant_<id> NOLOGIN` → `GRANT USAGE ON SCHEMA` →
`ALTER DEFAULT PRIVILEGES` → run every `TENANT_MIGRATIONS` entry via `dataSource.runMigrations()`
scoped to that schema. `TenantsService.provisionTenant()` calls it as part of the same in-process
request (matching the modular-monolith design's existing "one in-process operation" decision — no
new event/async machinery). `tenant-test-context.ts` calls the same service instead of
`AccountsService.provisionTenantSchema()`, which is deleted.

**Formal platform/tenant migration split — single source of truth.** Two exported arrays in
`apps/api/src/database/migrations/index.ts`:
- `PLATFORM_MIGRATIONS` (3 files): `CreateRbacCatalogTables` (0001), `AddRolePermissionsUniqueConstraint`
  (0003), `CreateTenantsTable` (0005) — shared/public-schema tables, run once by `migrate.ts`.
- `TENANT_MIGRATIONS` (14 files): every other migration — run per-tenant-schema by
  `TenantProvisioningService` (new tenants) and the new backfill runner (existing tenants).

`data-source.ts`'s `migrations` array becomes `PLATFORM_MIGRATIONS` (fixing its current
incomplete/inconsistent list as a side effect). `AccountsService.provisionTenantSchema()`'s
hardcoded manual `.up()` replay list is deleted in favor of `TENANT_MIGRATIONS` +
`dataSource.runMigrations()` — using TypeORM's own per-schema migration tracking table instead of
untracked manual replay, which is what makes the backfill runner below correct (it needs to know
which migrations a given tenant schema has already applied).

**The tenant-migration-runner** (`apps/api/src/database/migrate-tenants.ts`, new Nx target
`migrate-tenants`): reads every row from the `tenants` registry table; for each, sets `search_path`
to that tenant's schema and calls `dataSource.runMigrations()` with a `DataSource` configured with
only `TENANT_MIGRATIONS`. TypeORM's schema-scoped `migrations` tracking table means already-applied
migrations are skipped automatically per tenant — this is what actually closes the named gap:
rolling out a new migration to every already-provisioned tenant becomes one command, not a manual
per-schema operation.

**Proof of isolation — a real cross-role query, not just an app-level assertion.** A new
integration test opens a raw `pg` connection as `identity_access`, issues `SET LOCAL ROLE
tenant_<a>`, and attempts a direct `SELECT` against tenant B's schema — asserting Postgres itself
returns a `permission denied` error. This is what new-features.md's requirement actually asks for;
the existing `tenant-test-context.ts`-based isolation tests are kept as-is (they still correctly
test app-level routing) but this new test is what proves DB-level enforcement independent of
application code.

## Non-goals

- Per-tenant connection pools (rejected above).
- Any change to how `TenantContextMiddleware` derives the active tenant from a JWT — unaffected by
  this work.
- Tenant *de*-provisioning / role cleanup — not asked for by new-features.md #2, and no current
  code path removes a tenant at all.
- Migrating already-existing production tenant data — moot today, since no production tenant has
  ever been provisioned through a real path (only the test stand-in exists).

## Testing

- New unit/integration coverage for `TenantProvisioningService`: schema created, role created,
  default privileges applied, all `TENANT_MIGRATIONS` recorded as applied in that schema's own
  migrations table.
- `TenantsService.provisionTenant()`'s existing integration spec extended to assert the schema and
  role now really exist (not just the registry row).
- New `migrate-tenants` runner test: provision two tenants, add a throwaway migration to
  `TENANT_MIGRATIONS` after the fact, run the runner, assert both tenants' schemas received it and
  neither re-ran already-applied migrations.
- The new cross-role `permission denied` isolation test described above.
- Full existing suite (`nx run-many -t typecheck test lint`) must remain green — no behavior change
  to any currently-shipped domain module beyond how its schema/role get created.
