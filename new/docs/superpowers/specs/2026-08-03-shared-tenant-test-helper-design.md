# Shared `inTenant()` Test Helper — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 1 item 1 (`new-features.md` #5)

## Problem

Every one of the ~30 integration-spec files in `apps/api/src` hand-rolls the same setup:
`createDataSource()`, manual `TenantConnectionService`/`AccountsService` construction, a
`beforeAll`/`afterAll` pair that provisions a tenant schema and drops it, and a local
`inTenant()` closure over `TenantContextService.run(...)`. Two incompatible tenant-ID schemes
exist side by side — some files hardcode a fixed name (`'test_accounts'`, collides on repeated
runs against a persistent dev DB), others append `Date.now()`. There is no shared test
infrastructure module anywhere in `apps/api/src`.

This also blocks `new-features.md` #2 (database-enforced tenant isolation): proving isolation
needs reliable, consistent multi-tenant test infrastructure, which doesn't exist yet.

## Decisions

- **Isolation model: schema-drop**, matching the existing convention everywhere. Rejected
  transaction-rollback: the reporting archiver now writes on a dedicated connection, separate
  from the business transaction, by design (see `2026-08-01-reporting-archiver.md`). Rolling back
  a test's outer transaction would not roll back reporting (or audit) writes, since those run on
  different connections — leaving orphaned archive/audit rows referencing entities that never
  actually persisted. Schema-drop has no such hazard and matches how production actually behaves
  (business and archive writes are not atomic with each other today).
- **Migration scope: introduce + migrate all ~30 existing integration specs** onto the shared
  helper in this same effort, not introduce-only.
- **Tenant ID scheme: sequential, deterministic, test-only** — `${namePrefix}_1`,
  `${namePrefix}_2`, etc. (not a timestamp or random suffix). `setupTenantTestContext()` runs
  `DROP SCHEMA IF EXISTS "tenant_${namePrefix}_1" CASCADE` *before* provisioning, so a schema
  left behind by a crashed prior run is silently cleaned up rather than colliding with the next
  run. This scheme is scoped entirely to test tenant IDs — real tenant provisioning
  (`TenantsService.provisionTenant({ hospitalId, hospitalName })`) is unrelated and untouched.

## API

New module: `apps/api/src/testing/tenant-test-context.ts` — the first shared test-infrastructure
file in this app (no `testing/`-style directory exists yet).

```ts
interface TenantTestContext {
  dataSource: DataSource;
  tenantContext: TenantContextService;
  tenantConnection: TenantConnectionService;
  accountsService: AccountsService; // exposed, not hidden — needed by most files for provisioning
  tenantId: string;
  inTenant<T>(work: () => Promise<T>): Promise<T>;
  createTenant(): Promise<TenantTestContext>; // shares dataSource/tenantContext, new sequential tenantId
}

async function setupTenantTestContext(opts: {
  namePrefix: string;
  seedRbac?: boolean; // default false — only files creating staff accounts need it
}): Promise<TenantTestContext>;

async function teardownTenantTestContext(ctx: TenantTestContext): Promise<void>;
```

Each file keeps its own `beforeAll`/`afterAll` calling these two functions — no custom Jest
wrapper (`describeWithTenant(...)`) and no class-based fixture. This keeps the Jest lifecycle
visible in every file, matching current structure closely enough that a 30-file diff reads as
"same shape, less boilerplate," not a new abstraction to learn. `createTenant()` is for the
handful of files needing 2+ tenants (e.g. isolation tests) — it shares the parent's `dataSource`/
`tenantContext`/`tenantConnection` and returns a second context with the next sequential
`tenantId`.

Usage:

```ts
let ctx: TenantTestContext;

beforeAll(async () => {
  ctx = await setupTenantTestContext({ namePrefix: 'accounts', seedRbac: true });
});

afterAll(() => teardownTenantTestContext(ctx));

it('...', async () => {
  await ctx.inTenant(() => accountsService.createStaffAccount(...));
});
```

Both existing test-bootstrapping styles in this codebase are supported unchanged: files that
construct services directly (`new AccountsService(ctx.tenantConnection)`) and files that also
boot the full `AppModule` via `Test.createTestingModule` (the `TenantTestContext` only owns
schema provisioning/teardown/tenant-context execution — it's agnostic to whether the test then
calls a service method directly or drives the app via `supertest`).

## Migration

~30 files, mechanical, fixed target shape per file (per the API above) — dispatched as parallel
implementer subagents in batches grouped by domain module (accounts, billing, orders, admissions,
etc., mirroring the existing directory structure), each batch's diff reviewed before the next.
Exact batch sizes and review checkpoints are an implementation-plan concern, not a design one.

## Documentation

Short addition to `apps/api/src` `TESTING.md`-equivalent docs: document `inTenant()` as the
standard pattern going forward, and note that audit/reporting subscribers fire on any tracked
insert regardless of the test's isolation model, write into the same tenant schema under test
(audit via the main connection pool, reporting via its dedicated pool — see the reporting-archiver
work), and are cleaned up by the same `DROP SCHEMA CASCADE` teardown since they're schema-scoped,
not transaction-scoped.

## Out of scope

- Migrating tenant-ID schemes for real (non-test) tenant provisioning.
- Changing the isolation model for any test (settled: schema-drop, no exceptions).
- New test coverage beyond what each file already has — this is a refactor of setup/teardown, not
  a coverage expansion. (Coverage for `new-features.md` #2's isolation guarantees is separate,
  follow-on work that this helper unblocks.)
