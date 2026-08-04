# Database-Enforced Tenant Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is written for inline execution by an implementer with full session context — exact code/SQL/commands are still given in full (no placeholders), but the "explain the codebase from scratch" framing is skipped.

**Goal:** Real Postgres-level tenant isolation — per-tenant DB roles with schema grants, a real
production tenant-provisioning path (doesn't exist today), and a migration runner that can roll
out new migrations to already-provisioned tenants.

**Architecture:** `identity_access` (the app's one DB role) becomes a member of every tenant's
`NOLOGIN` role and uses `SET LOCAL ROLE` inside an explicit transaction to scope each request to
one tenant's grants. A new `TenantProvisioningService` creates the schema + role + grants + runs
migrations in one in-process operation, called from both production (`TenantsService.provisionTenant()`)
and tests (`tenant-test-context.ts`). Migrations split into `PLATFORM_MIGRATIONS` (run once) and
`TENANT_MIGRATIONS` (run per-tenant-schema, via a dedicated `DataSource` using TypeORM's `schema`
option — not a manually-set `search_path`, since `runMigrations()` opens its own internal
connection that wouldn't see a `SET search_path` issued on a different queryRunner).

**Tech Stack:** TypeORM 1.1 (Postgres driver), Postgres 16, no new dependencies.

## Global Constraints

- Schema name and role name are the **same string** for a given tenant: `tenant_<hospitalId>`.
  `SAFE_TENANT_ID = /^[a-z0-9_]+$/` (already used by the code being replaced) validates the raw
  `hospitalId` before it's ever interpolated into SQL.
- Tenant roles are `NOLOGIN` — no password to create/rotate/store. `SET ROLE` succeeds via
  membership (`GRANT tenant_<id> TO identity_access`), not a credential.
- Grant ordering is two-part, not one: `ALTER DEFAULT PRIVILEGES` only covers objects created
  *after* it runs — the initial batch of tables created by the first migration run need an
  explicit `GRANT ALL ON ALL TABLES/SEQUENCES IN SCHEMA ... TO ...` too.
- `SET LOCAL` (role or search_path) is a **silent no-op outside an explicit transaction** — this is
  why `TenantConnectionService.runInTenantSchema()` must wrap its work in
  `startTransaction()`/`commitTransaction()`/`rollbackTransaction()`, not just add a `SET LOCAL`
  query to the existing non-transactional flow.
- `.js` extensions on every relative import (ESM + `nodenext`). Run
  `pnpm exec nx run-many -t typecheck test lint` before considering any task done.
- Never `git commit --amend`. No AI co-authorship trailer in any commit message.
- `AccountsService.provisionTenantSchema()` is deleted in this plan (Task 4) — its only caller
  (`tenant-test-context.ts`) is migrated to the new `TenantProvisioningService` first.

---

### Task 1: Split migrations into `PLATFORM_MIGRATIONS` / `TENANT_MIGRATIONS`

**Files:**
- Create: `new/code/apps/api/src/database/migrations/index.ts`
- Modify: `new/code/apps/api/src/database/data-source.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `PLATFORM_MIGRATIONS: MigrationInterface[]`, `TENANT_MIGRATIONS: MigrationInterface[]`
  (both exported from `migrations/index.ts`) — consumed by Task 2's tenant migration DataSource
  factory and Task 1's own fix to `data-source.ts`.

- [ ] **Step 1: Create the migrations index**

Create `new/code/apps/api/src/database/migrations/index.ts`:

```ts
import { CreateRbacCatalogTables } from './0001-create-rbac-catalog-tables.js';
import { CreateTenantAccountTables } from './0002-create-tenant-account-tables.js';
import { AddRolePermissionsUniqueConstraint } from './0003-add-role-permissions-unique-constraint.js';
import { AddAccountRolesUniqueActiveAssignment } from './0004-add-account-roles-unique-active-assignment.js';
import { CreateTenantsTable } from './0005-create-tenants-table.js';
import { CreatePatientTables005 } from './005_create_patient_tables.js';
import { CreateAuditRecordsTable } from './0006-create-audit-records-table.js';
import { CreateMasterDataTables } from './0007-create-master-data-tables.js';
import { CreateAppointmentsTable0009 } from './0009-create-appointments-table.js';
import { CreateVitalsTable0010 } from './0010-create-vitals-table.js';
import { CreateEncounterTables011 } from './0011_create_encounter_tables.js';
import { CreateTriageTable0012 } from './0012-create-triage-table.js';
import { CreateBedsTable0013 } from './0013-create-beds-table.js';
import { CreateAdmissionsTables0014 } from './0014-create-admissions-tables.js';
import { CreateOrdersTables0015 } from './0015-create-orders-tables.js';
import { CreateBillingTables0016 } from './0016-create-billing-tables.js';
import { CreateReportingTables0017 } from './0017-create-reporting-tables.js';

// Platform-level migrations: create shared/public-schema tables (RBAC catalog, tenant registry).
// Run once by migrate.ts. Never replayed per-tenant schema.
export const PLATFORM_MIGRATIONS = [
  CreateRbacCatalogTables,
  AddRolePermissionsUniqueConstraint,
  CreateTenantsTable,
];

// Tenant-scoped migrations: create per-tenant-schema tables. Run once per tenant by
// TenantProvisioningService (new tenants) and migrate-tenants.ts (backfilling existing ones).
// Order matches the proven-working order from the AccountsService.provisionTenantSchema()
// stand-in this replaces — dependent tables follow what they reference (e.g. account_roles
// after accounts).
export const TENANT_MIGRATIONS = [
  CreateTenantAccountTables,
  AddAccountRolesUniqueActiveAssignment,
  CreateAuditRecordsTable,
  CreateMasterDataTables,
  CreatePatientTables005,
  CreateAppointmentsTable0009,
  CreateVitalsTable0010,
  CreateEncounterTables011,
  CreateTriageTable0012,
  CreateBedsTable0013,
  CreateAdmissionsTables0014,
  CreateOrdersTables0015,
  CreateBillingTables0016,
  CreateReportingTables0017,
];
```

- [ ] **Step 2: Point `data-source.ts` at `PLATFORM_MIGRATIONS`**

In `new/code/apps/api/src/database/data-source.ts`, replace the block of 11 individual migration
imports (`CreateRbacCatalogTables` through `CreateReportingTables0017`) with:

```ts
import { PLATFORM_MIGRATIONS } from './migrations/index.js';
```

And change the `migrations:` field in `createDataSource()`'s returned config from the inline array
to:

```ts
    migrations: PLATFORM_MIGRATIONS,
```

- [ ] **Step 3: Typecheck and run the existing suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: all 4 projects green, same counts as before this task — this step only changes which
migrations `migrate.ts`'s `DataSource` knows about (fixing the pre-existing 6-file gap), it doesn't
touch any runtime path any current test exercises.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts
git commit -m "feat(database): split migrations into PLATFORM_MIGRATIONS/TENANT_MIGRATIONS"
```

---

### Task 2: Tenant-scoped migration DataSource factory

**Files:**
- Create: `new/code/apps/api/src/database/tenant-migration-data-source.ts`

**Interfaces:**
- Consumes: `TENANT_MIGRATIONS` (Task 1)
- Produces: `createTenantMigrationDataSource(schemaName: string): DataSource` — consumed by
  Task 3's `TenantProvisioningService` and Task 8's `migrate-tenants.ts` runner.

- [ ] **Step 1: Write the factory**

Create `new/code/apps/api/src/database/tenant-migration-data-source.ts`:

```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TENANT_MIGRATIONS } from './migrations/index.js';

/**
 * A DataSource scoped to one tenant's schema via TypeORM's `schema` option — not a manually-run
 * `SET search_path` query, because `runMigrations()` opens its own internal connection that
 * wouldn't see a search_path set on a separately-created queryRunner. `schema` makes every
 * connection this DataSource creates default to the given schema, including that internal one.
 * TypeORM's migration-tracking table therefore lives inside that schema too, so re-running this
 * against an already-migrated tenant only applies migrations that specific schema hasn't seen yet.
 */
export function createTenantMigrationDataSource(schemaName: string): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    schema: schemaName,
    migrations: TENANT_MIGRATIONS,
    synchronize: false,
    extra: {
      connectionTimeoutMillis: 5000,
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec nx run-many -t typecheck
```

Expected: clean — this file has no consumers yet, this step only confirms it compiles.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/tenant-migration-data-source.ts
git commit -m "feat(database): add tenant-scoped migration DataSource factory"
```

---

### Task 3: `TenantProvisioningService`

**Files:**
- Create: `new/code/apps/api/src/database/tenant-provisioning.service.ts`
- Test: `new/code/apps/api/src/database/tenant-provisioning.service.integration-spec.ts`

**Interfaces:**
- Consumes: `createTenantMigrationDataSource` (Task 2)
- Produces: `TenantProvisioningService.provisionTenantSchema(tenantId: string): Promise<void>` —
  consumed by Task 5 (`TenantsService`) and Task 6 (`tenant-test-context.ts`).

- [ ] **Step 1: Write the failing test**

Create `new/code/apps/api/src/database/tenant-provisioning.service.integration-spec.ts`:

```ts
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

describe('TenantProvisioningService (integration)', () => {
  let dataSource: DataSource;
  let service: TenantProvisioningService;
  const tenantId = 'provisioning_svc_test';
  const schemaName = `tenant_${tenantId}`;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    service = new TenantProvisioningService(dataSource);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.destroy();
  });

  it('creates the schema, the role, and runs every tenant migration', async () => {
    await service.provisionTenantSchema(tenantId);

    const schemaRows = await dataSource.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [schemaName],
    );
    expect(schemaRows).toHaveLength(1);

    const roleRows = await dataSource.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [schemaName]);
    expect(roleRows).toHaveLength(1);

    // accounts table (from the first tenant migration) exists in the new schema
    const tableRows = await dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'accounts'`,
      [schemaName],
    );
    expect(tableRows).toHaveLength(1);
  });

  it('grants the role SELECT/INSERT/UPDATE/DELETE on the schema it just created', async () => {
    const grantRows = await dataSource.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND table_name = 'accounts' AND grantee = $2
       ORDER BY privilege_type`,
      [schemaName, schemaName],
    );
    const privileges = grantRows.map((r: { privilege_type: string }) => r.privilege_type);
    expect(privileges).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']));
  });

  it('grants identity_access membership in the tenant role, so SET ROLE succeeds', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();
      await expect(queryRunner.query(`SET LOCAL ROLE "${schemaName}"`)).resolves.not.toThrow();
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  });

  it('rejects an unsafe tenant id', async () => {
    await expect(service.provisionTenantSchema('bad; DROP TABLE tenants;')).rejects.toThrow(
      'Refusing to provision unsafe tenant id',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-provisioning.service
```

Expected: FAIL — `Cannot find module './tenant-provisioning.service.js'`.

- [ ] **Step 3: Write the implementation**

Create `new/code/apps/api/src/database/tenant-provisioning.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a tenant's schema and role, grants the role access, runs every TENANT_MIGRATIONS
   * entry against the new schema, and grants identity_access membership in the role so
   * TenantConnectionService can SET ROLE into it per request. The single real production path —
   * called from TenantsService.provisionTenant() and the test helper alike.
   */
  async provisionTenantSchema(tenantId: string): Promise<void> {
    if (!SAFE_TENANT_ID.test(tenantId)) {
      throw new Error(`Refusing to provision unsafe tenant id: ${tenantId}`);
    }
    // Schema name and role name are the same string for a given tenant.
    const name = `tenant_${tenantId}`;
    const adminRole = process.env['DB_USERNAME'] ?? 'identity_access';

    const setupRunner = this.dataSource.createQueryRunner();
    await setupRunner.connect();
    try {
      await setupRunner.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
      await setupRunner.query(`CREATE ROLE "${name}" NOLOGIN`);
      await setupRunner.query(`GRANT USAGE ON SCHEMA "${name}" TO "${name}"`);
      // Covers tables/sequences created by FUTURE migrations (migrate-tenants.ts backfills) —
      // does NOT cover the tables the migration run below is about to create; those need the
      // explicit GRANT after runMigrations() completes.
      await setupRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${name}" GRANT ALL ON TABLES TO "${name}"`,
      );
      await setupRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${name}" GRANT ALL ON SEQUENCES TO "${name}"`,
      );
    } finally {
      await setupRunner.release();
    }

    const migrationDataSource = createTenantMigrationDataSource(name);
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.runMigrations({ transaction: 'each' });
    } finally {
      await migrationDataSource.destroy();
    }

    const grantRunner = this.dataSource.createQueryRunner();
    await grantRunner.connect();
    try {
      // Explicit grant for the tables/sequences the migration run above just created — default
      // privileges set earlier only apply to objects created after they were set.
      await grantRunner.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${name}" TO "${name}"`);
      await grantRunner.query(`GRANT ALL ON ALL SEQUENCES IN SCHEMA "${name}" TO "${name}"`);
      // Membership, not a login credential: lets identity_access SET ROLE into this tenant.
      await grantRunner.query(`GRANT "${name}" TO "${adminRole}"`);
    } finally {
      await grantRunner.release();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-provisioning.service
```

Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/tenant-provisioning.service.ts apps/api/src/database/tenant-provisioning.service.integration-spec.ts
git commit -m "feat(database): add TenantProvisioningService (schema + role + grants + migrations)"
```

---

### Task 4: `TenantConnectionService` — `SET LOCAL ROLE` inside a real transaction

**Files:**
- Modify: `new/code/apps/api/src/database/tenant-connection.service.ts`
- Test: `new/code/apps/api/src/database/tenant-connection.service.integration-spec.ts` (create if it
  doesn't exist yet — check first)

**Interfaces:**
- Consumes: nothing new
- Produces: same public signature as before
  (`runInTenantSchema<T>(work, dataSourceOverride?): Promise<T>`) — no caller across the 85 existing
  call sites needs to change, this task only changes the method's internals.

- [ ] **Step 1: Check for an existing test file**

```bash
ls apps/api/src/database/tenant-connection.service.integration-spec.ts 2>/dev/null && echo EXISTS || echo MISSING
```

If `MISSING`, create it fresh in Step 2 below. If `EXISTS`, read it first and add the new test
cases to it rather than overwriting.

- [ ] **Step 2: Write the failing test**

```ts
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

describe('TenantConnectionService (integration)', () => {
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let connectionService: TenantConnectionService;
  const tenantId = 'conn_svc_test';
  const schemaName = `tenant_${tenantId}`;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    tenantContext = new TenantContextService();
    connectionService = new TenantConnectionService(dataSource, tenantContext);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await new TenantProvisioningService(dataSource).provisionTenantSchema(tenantId);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.destroy();
  });

  it('SET LOCAL ROLE actually applies within runInTenantSchema (transaction-scoped)', async () => {
    const currentRole = await tenantContext.run({ tenantId, correlationId: 'test' }, () =>
      connectionService.runInTenantSchema(async (manager) => {
        const rows = await manager.query('SELECT current_user AS role');
        return rows[0].role;
      }),
    );
    expect(currentRole).toBe(schemaName);
  });

  it('the elevated role does not leak to a later query on a fresh call', async () => {
    // Run once inside tenant context (role gets set), then once with a plain query outside any
    // tenant context, on a fresh queryRunner — proves SET LOCAL's transaction scoping actually
    // resets, not just that this specific test asserts it did.
    await tenantContext.run({ tenantId, correlationId: 'test' }, () =>
      connectionService.runInTenantSchema(async (manager) => {
        await manager.query('SELECT 1');
      }),
    );

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      const rows = await queryRunner.query('SELECT current_user AS role');
      expect(rows[0].role).not.toBe(schemaName);
    } finally {
      await queryRunner.release();
    }
  });

  it('rolls back the transaction if work() throws', async () => {
    await expect(
      tenantContext.run({ tenantId, correlationId: 'test' }, () =>
        connectionService.runInTenantSchema(async () => {
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-connection.service
```

Expected: FAIL on the first test — `current_user` is `identity_access`, not `tenant_conn_svc_test`,
since `runInTenantSchema` doesn't `SET ROLE` yet.

- [ ] **Step 4: Write the implementation**

Replace the body of `runInTenantSchema` in
`new/code/apps/api/src/database/tenant-connection.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';

const SAFE_SCHEMA_NAME = /^tenant_[a-z0-9_]+$/;

@Injectable()
export class TenantConnectionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * @param dataSourceOverride Optional alternative `DataSource` (i.e. a different connection pool)
   * to take the connection from. Defaults to the main injected `DataSource`. Tenant resolution and
   * schema-name validation are identical either way — the override only changes which pool the
   * connection comes from.
   */
  async runInTenantSchema<T>(
    work: (manager: EntityManager) => Promise<T>,
    dataSourceOverride?: DataSource,
  ): Promise<T> {
    const dataSource = dataSourceOverride ?? this.dataSource;
    const schemaName = this.tenantContext.getSchemaName();
    if (!schemaName) {
      throw new Error('No tenant context set — cannot resolve a schema for this query.');
    }
    if (!SAFE_SCHEMA_NAME.test(schemaName)) {
      throw new Error(`Refusing to use unsafe schema name: ${schemaName}`);
    }

    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // SET LOCAL only takes effect inside an explicit transaction — outside one it silently
      // no-ops rather than erroring, which is why startTransaction() above is load-bearing, not
      // optional. Scoping both to the transaction means a pooled connection can never leak an
      // elevated role or the wrong search_path into whatever request reuses it next — both reset
      // automatically when the transaction ends, whether committed or rolled back.
      await queryRunner.query(`SET LOCAL ROLE "${schemaName}"`);
      await queryRunner.query(`SET LOCAL search_path TO "${schemaName}", public`);
      const result = await work(queryRunner.manager);
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-connection.service
```

Expected: PASS, 3/3 tests.

- [ ] **Step 6: Run the full suite — this is the highest-blast-radius step in the whole plan**

`runInTenantSchema` has 85 call sites across 15 files. This step is what actually proves wrapping
every call in an explicit transaction didn't change observable behavior anywhere.

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: same pass counts as the last known-green baseline. If anything fails, read the actual
failure — do not assume it's unrelated. The most likely real failure mode: a caller that assumed
`work()`'s writes were durable even if a *later*, separate call to `runInTenantSchema` failed —
that assumption was always false (no code ever provided that guarantee), so a failure here would
indicate a test asserting behavior that was accidentally relying on it, not a regression this task
introduced.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/tenant-connection.service.ts apps/api/src/database/tenant-connection.service.integration-spec.ts
git commit -m "feat(database): SET LOCAL ROLE inside a real transaction in runInTenantSchema"
```

---

### Task 5: Wire `TenantsService.provisionTenant()` to real provisioning

**Files:**
- Modify: `new/code/apps/api/src/tenants/tenants.service.ts`
- Modify: `new/code/apps/api/src/tenants/tenants.module.ts`
- Modify: `new/code/apps/api/src/tenants/tenants.controller.integration-spec.ts` (fix teardown —
  see Step 4 below)
- Modify: `new/code/apps/api/src/tenants/tenants.service.integration-spec.ts` (constructs
  `TenantsService` directly, bypassing DI — needs the new constructor param; fix teardown — see
  Step 5 below)

**Interfaces:**
- Consumes: `TenantProvisioningService` (Task 3)
- Produces: `TenantsService.provisionTenant()` now creates a real schema+role, not just a registry
  row — consumed by Task 6 (test helper switches to the same underlying service).

- [ ] **Step 1: Add `TenantProvisioningService` to `TenantsModule`**

In `new/code/apps/api/src/tenants/tenants.module.ts`, add the import and provider:

```ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantProvisioningService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

- [ ] **Step 2: Call it from `provisionTenant()`**

In `new/code/apps/api/src/tenants/tenants.service.ts`, inject `TenantProvisioningService` and call
it after the uniqueness check passes but as part of the same request:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

export interface ProvisionTenantInput {
  hospitalId: string;
  hospitalName: string;
  createdBy?: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantProvisioning: TenantProvisioningService,
  ) {}

  async provisionTenant(input: ProvisionTenantInput): Promise<Tenant> {
    if (!SAFE_HOSPITAL_ID.test(input.hospitalId)) {
      throw new BadRequestException(`Invalid hospitalId format: ${input.hospitalId}`);
    }

    const repository = this.dataSource.getRepository(Tenant);
    const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
    if (existing) {
      throw new ConflictException(`Tenant ${input.hospitalId} already exists`);
    }

    // Schema/role/migrations before the registry row: if provisioning fails partway through, no
    // registry row exists to make the tenant look ready when it isn't. A retry with the same
    // hospitalId then hits CREATE SCHEMA IF NOT EXISTS / CREATE ROLE cleanly for the schema (the
    // role isn't idempotent — see the Dependencies note in this plan's header about production
    // retry semantics being a known follow-up, not solved here).
    await this.tenantProvisioning.provisionTenantSchema(input.hospitalId);

    return repository.save(
      repository.create({
        hospitalId: input.hospitalId,
        hospitalName: input.hospitalName,
        status: 'active',
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: input.createdBy ?? null,
      }),
    );
  }

  async listTenants(): Promise<Tenant[]> {
    return this.dataSource.getRepository(Tenant).find({ order: { createdAt: 'ASC' } });
  }

  async getTenant(hospitalId: string): Promise<Tenant | null> {
    return this.dataSource.getRepository(Tenant).findOne({ where: { hospitalId } });
  }

  async suspendTenant(hospitalId: string): Promise<Tenant> {
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'suspended') {
      return tenant;
    }
    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    return repository.save(tenant);
  }

  async reactivateTenant(hospitalId: string): Promise<Tenant> {
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'active') {
      return tenant;
    }
    tenant.status = 'active';
    tenant.activatedAt = new Date();
    return repository.save(tenant);
  }
}
```

- [ ] **Step 3: Run typecheck — expect a real break**

```bash
pnpm exec nx run-many -t typecheck
```

Expected: FAILS. `tenants.service.integration-spec.ts:15` constructs `TenantsService` directly
(`new TenantsService(ctx.dataSource)`), bypassing Nest DI — it needs the new second constructor
argument. Fixed in the next step.

- [ ] **Step 4: Fix `tenants.service.integration-spec.ts` — constructor arg and teardown leak**

This spec constructs `TenantsService` directly and calls `provisionTenant()` 7 times
(`test_tenant_svc_provision`, `_dup`, `_list`, `_get`, `_suspend`, `_suspend_twice`,
`_reactivate`), with the same teardown gap as the controller spec below: `afterAll` only deletes
the registry rows, never the schema/role `provisionTenant()` now also creates. Fix both:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('TenantsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantsService: TenantsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_svc' });
    tenantsService = new TenantsService(ctx.dataSource, new TenantProvisioningService(ctx.dataSource));
  });

  afterAll(async () => {
    const hospitalIds: { hospitalId: string }[] = await ctx.dataSource.query(
      `SELECT "hospitalId" FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`,
    );
    for (const { hospitalId } of hospitalIds) {
      const name = `tenant_${hospitalId}`;
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${name}"`);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`);
    await teardownTenantTestContext(ctx);
  });

  // ...every `it(...)` block below this line is unchanged from the current file...
```

Only the imports, `beforeAll`, and `afterAll` change — every `it(...)` test body stays exactly as
it is today.

- [ ] **Step 5: Fix `tenants.controller.integration-spec.ts`'s teardown**

This spec already calls the real `POST /tenants` endpoint 5 times (`test_tenant_ctrl_create`,
`_dup`, `_list`, `_get`, `_lifecycle`) but its `afterAll` only deletes the registry rows — now that
`provisionTenant()` creates a real schema+role, every test run would leak them, and a second run
would fail on `CREATE ROLE` erroring against an already-existing role. Replace the `afterAll` block:

```ts
  afterAll(async () => {
    const hospitalIds: { hospitalId: string }[] = await ctx.dataSource.query(
      `SELECT "hospitalId" FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`,
    );
    for (const { hospitalId } of hospitalIds) {
      const name = `tenant_${hospitalId}`;
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${name}"`);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`);
    await teardownTenantTestContext(ctx);
    await app.close();
  });
```

- [ ] **Step 6: Run both tenants specs, then the full suite**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenants.service tenants.controller
pnpm exec nx run-many -t typecheck test lint
```

Expected: PASS. Run both spec files **twice in a row** locally (not just once) to prove the
teardown fixes actually make them re-runnable — this is the scenario that would have failed
silently before this task.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tenants/tenants.service.ts apps/api/src/tenants/tenants.module.ts apps/api/src/tenants/tenants.service.integration-spec.ts apps/api/src/tenants/tenants.controller.integration-spec.ts
git commit -m "feat(tenants): provisionTenant() creates a real schema, role, and grants"
```

---

### Task 6: Migrate the test helper off the deleted stand-in

**Files:**
- Modify: `new/code/apps/api/src/testing/tenant-test-context.ts`
- Modify: `new/code/apps/api/src/accounts/accounts.service.ts` (delete `provisionTenantSchema` and
  its now-unused migration imports)

**Interfaces:**
- Consumes: `TenantProvisioningService` (Task 3)
- Produces: same `TenantTestContext` public shape as before — no test file using
  `setupTenantTestContext`/`teardownTenantTestContext` needs to change.

- [ ] **Step 1: Switch `tenant-test-context.ts` to `TenantProvisioningService`**

In `new/code/apps/api/src/testing/tenant-test-context.ts`, replace the `AccountsService` import and
every reference to it with `TenantProvisioningService`:

```ts
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

export interface TenantTestContext {
  dataSource: DataSource;
  tenantContext: TenantContextService;
  tenantConnection: TenantConnectionService;
  accountsService: AccountsService;
  tenantId: string;
  inTenant<T>(work: () => Promise<T>): Promise<T>;
  createTenant(): Promise<TenantTestContext>;
}

export interface TenantTestContextOptions {
  namePrefix: string;
  seedRbac?: boolean;
}

const tenantRegistry = new WeakMap<DataSource, string[]>();

function registerTenant(dataSource: DataSource, tenantId: string): void {
  const ids = tenantRegistry.get(dataSource) ?? [];
  ids.push(tenantId);
  tenantRegistry.set(dataSource, ids);
}

async function provisionTenant(
  dataSource: DataSource,
  tenantProvisioning: TenantProvisioningService,
  tenantId: string,
): Promise<void> {
  // Idempotent: drops any schema/role left behind by a crashed prior run before creating a fresh
  // one, so deterministic sequential IDs (namePrefix_1, namePrefix_2, ...) never collide.
  await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  await dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
  registerTenant(dataSource, tenantId);
  await tenantProvisioning.provisionTenantSchema(tenantId);
}

function buildContext(
  dataSource: DataSource,
  tenantContext: TenantContextService,
  tenantConnection: TenantConnectionService,
  tenantProvisioning: TenantProvisioningService,
  accountsService: AccountsService,
  namePrefix: string,
  sequence: { next: number },
): TenantTestContext {
  const tenantId = `${namePrefix}_${sequence.next}`;

  return {
    dataSource,
    tenantContext,
    tenantConnection,
    accountsService,
    tenantId,
    inTenant<T>(work: () => Promise<T>): Promise<T> {
      return tenantContext.run({ tenantId, correlationId: 'test' }, work);
    },
    async createTenant(): Promise<TenantTestContext> {
      sequence.next += 1;
      const nextCtx = buildContext(
        dataSource,
        tenantContext,
        tenantConnection,
        tenantProvisioning,
        accountsService,
        namePrefix,
        sequence,
      );
      await provisionTenant(dataSource, tenantProvisioning, nextCtx.tenantId);
      return nextCtx;
    },
  };
}

export async function setupTenantTestContext(
  options: TenantTestContextOptions,
): Promise<TenantTestContext> {
  if (!/^[a-z0-9_]+$/.test(options.namePrefix)) {
    throw new Error(`namePrefix must match /^[a-z0-9_]+$/ (got: ${options.namePrefix})`);
  }

  const dataSource = createDataSource();
  await dataSource.initialize();

  if (options.seedRbac) {
    await seedRbacCatalog(dataSource);
  }

  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const tenantProvisioning = new TenantProvisioningService(dataSource);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const sequence = { next: 1 };

  const ctx = buildContext(
    dataSource,
    tenantContext,
    tenantConnection,
    tenantProvisioning,
    accountsService,
    options.namePrefix,
    sequence,
  );
  await provisionTenant(dataSource, tenantProvisioning, ctx.tenantId);

  return ctx;
}

export async function teardownTenantTestContext(ctx: TenantTestContext): Promise<void> {
  if (ctx.dataSource.isInitialized) {
    const tenantIds = tenantRegistry.get(ctx.dataSource) ?? [ctx.tenantId];
    for (const tenantId of tenantIds) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
    }
    tenantRegistry.delete(ctx.dataSource);
    await ctx.dataSource.destroy();
  }
}
```

- [ ] **Step 2: Delete `provisionTenantSchema` and its now-unused imports from `AccountsService`**

In `new/code/apps/api/src/accounts/accounts.service.ts`, delete the `provisionTenantSchema` method
(lines ~50-95 — the whole method, including its doc comment) and every migration import at the top
of the file that only that method used:
`CreateTenantAccountTables`, `AddAccountRolesUniqueActiveAssignment`, `CreateAuditRecordsTable`,
`CreateMasterDataTables`, `CreatePatientTables005`, `CreateAppointmentsTable0009`,
`CreateVitalsTable0010`, `CreateEncounterTables011`, `CreateTriageTable0012`, `CreateBedsTable0013`,
`CreateAdmissionsTables0014`, `CreateOrdersTables0015`, `CreateBillingTables0016`,
`CreateReportingTables0017`. Keep the `DataSource`/`In` import from `typeorm` and every other method
untouched — `AccountsService` still handles staff account creation.

- [ ] **Step 3: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: every existing integration spec that uses `setupTenantTestContext`/`createTenant()`
(~40 files) still passes — this task changes what happens *inside* provisioning, not the
`TenantTestContext` interface any of them consume.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/testing/tenant-test-context.ts apps/api/src/accounts/accounts.service.ts
git commit -m "refactor(testing): use TenantProvisioningService, delete the test-only stand-in"
```

---

### Task 7: Cross-role isolation test — the actual proof

**Files:**
- Create: `new/code/apps/api/src/database/tenant-role-isolation.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantProvisioningService` (Task 3), `TenantConnectionService` (Task 4)
- Produces: nothing (terminal proof, no later task depends on this file)

- [ ] **Step 1: Write the test**

```ts
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

describe('Tenant role isolation (integration)', () => {
  let dataSource: DataSource;
  const tenantA = 'role_iso_a';
  const tenantB = 'role_iso_b';

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    const provisioning = new TenantProvisioningService(dataSource);
    for (const tenantId of [tenantA, tenantB]) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
      await dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
      await provisioning.provisionTenantSchema(tenantId);
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
      await dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
    }
    await dataSource.destroy();
  });

  it('rejects a direct cross-schema query at the database level, independent of application code', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`SET LOCAL ROLE "tenant_${tenantA}"`);
      // Not going through TenantConnectionService or search_path at all — this is the point: even
      // an application bug that fully bypasses the app's own tenant-routing (wrong search_path,
      // wrong middleware, anything) cannot read tenant B's data, because the active DB role
      // simply has no grant on tenant B's schema.
      await expect(
        queryRunner.query(`SELECT * FROM "tenant_${tenantB}".accounts`),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('the same role can read its own schema fine', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`SET LOCAL ROLE "tenant_${tenantA}"`);
      await expect(
        queryRunner.query(`SELECT * FROM "tenant_${tenantA}".accounts`),
      ).resolves.toEqual([]);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });

  it('a role with no SET ROLE membership is refused entirely', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await expect(queryRunner.query(`SET LOCAL ROLE "tenant_${tenantB}_nonexistent"`)).rejects.toThrow();
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
```

- [ ] **Step 2: Run it**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-role-isolation
```

Expected: PASS, 3/3 — the middle test would fail with today's code (before this plan) exactly the
same way the first one would, since both would previously succeed for the *wrong* reason (no role
restriction existed at all). Confirm mentally, don't just trust green: temporarily commenting out
this task's grant statements in `TenantProvisioningService` and re-running should turn the first
test red — that's the signal this test is actually testing something, not vacuously passing.

- [ ] **Step 3: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/tenant-role-isolation.integration-spec.ts
git commit -m "test(database): prove cross-tenant DB access fails at the role level"
```

---

### Task 8: `migrate-tenants` backfill runner

**Files:**
- Create: `new/code/apps/api/src/database/migrate-tenants.ts`
- Modify: `new/code/apps/api/package.json` (new Nx target)
- Test: `new/code/apps/api/src/database/migrate-tenants.integration-spec.ts`

**Interfaces:**
- Consumes: `createTenantMigrationDataSource` (Task 2), `Tenant` entity, `createDataSource`
- Produces: `runTenantMigrations(): Promise<{ tenantsProcessed: number }>` (exported so the test can
  call it directly, matching `migrate.ts`'s existing standalone-script pattern) + a `migrate-tenants`
  Nx target

- [ ] **Step 1: Write the failing test**

Create `new/code/apps/api/src/database/migrate-tenants.integration-spec.ts`:

```ts
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { runTenantMigrations } from './migrate-tenants.js';

describe('migrate-tenants runner (integration)', () => {
  let dataSource: DataSource;
  const tenantId = 'migrate_runner_test';
  const schemaName = `tenant_${tenantId}`;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await new TenantProvisioningService(dataSource).provisionTenantSchema(tenantId);
    await dataSource.getRepository(Tenant).save(
      dataSource.getRepository(Tenant).create({
        hospitalId: tenantId,
        hospitalName: 'Migrate Runner Test Hospital',
        status: 'active',
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: null,
      }),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ hospitalId: tenantId });
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.destroy();
  });

  it('processes every registered tenant without re-erroring on already-applied migrations', async () => {
    const result = await runTenantMigrations();
    expect(result.tenantsProcessed).toBeGreaterThanOrEqual(1);

    // Confirm it's genuinely idempotent, not just "happened not to error once"
    const secondResult = await runTenantMigrations();
    expect(secondResult.tenantsProcessed).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api migrate-tenants
```

Expected: FAIL — `Cannot find module './migrate-tenants.js'`.

- [ ] **Step 3: Write the implementation**

Create `new/code/apps/api/src/database/migrate-tenants.ts`:

```ts
import 'reflect-metadata';
import { createDataSource } from './data-source.js';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';

/**
 * Applies every TENANT_MIGRATIONS entry a given tenant schema hasn't already applied. TypeORM's
 * per-schema migration tracking (via createTenantMigrationDataSource's `schema` option) means this
 * is safe to run repeatedly and against every tenant at once — the gap this closes: rolling out a
 * new migration to every already-provisioned tenant becomes one command, not a manual per-schema
 * operation.
 */
export async function runTenantMigrations(): Promise<{ tenantsProcessed: number }> {
  const registryDataSource = createDataSource();
  await registryDataSource.initialize();
  let tenants: Tenant[];
  try {
    tenants = await registryDataSource.getRepository(Tenant).find();
  } finally {
    await registryDataSource.destroy();
  }

  for (const tenant of tenants) {
    const schemaName = `tenant_${tenant.hospitalId}`;
    const migrationDataSource = createTenantMigrationDataSource(schemaName);
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.runMigrations({ transaction: 'each' });
    } finally {
      await migrationDataSource.destroy();
    }
  }

  return { tenantsProcessed: tenants.length };
}

async function main(): Promise<void> {
  const { tenantsProcessed } = await runTenantMigrations();
  console.log(`migrate-tenants: applied pending migrations across ${tenantsProcessed} tenant schema(s).`);
}

// Only run as a script when invoked directly (`node migrate-tenants.js`), not when imported by the
// integration spec above — matches the existing migrate.ts convention of no such guard, but this
// file needs one since, unlike migrate.ts, it's also imported as a module by its own test.
if (process.argv[1]?.endsWith('migrate-tenants.js') || process.argv[1]?.endsWith('migrate-tenants.ts')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api migrate-tenants
```

Expected: PASS, 1/1.

- [ ] **Step 5: Add the Nx target**

`migrate.ts` currently has no Nx target or `package.json` script at all — it's run ad-hoc. Add a
new `migrate-tenants` target using `tsx` (already a workspace devDependency) in
`new/code/apps/api/package.json`'s `"nx"."targets"` object, alongside the existing `build`/`serve`
targets:

```json
      "migrate-tenants": {
        "executor": "nx:run-commands",
        "options": {
          "command": "tsx src/database/migrate-tenants.ts",
          "cwd": "apps/api"
        }
      },
```

Verify it runs: `pnpm exec nx run api:migrate-tenants` (from `new/code/`) should print the
"applied pending migrations across N tenant schema(s)" line with no error.

- [ ] **Step 6: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/database/migrate-tenants.ts apps/api/src/database/migrate-tenants.integration-spec.ts apps/api/package.json
git commit -m "feat(database): add migrate-tenants backfill runner"
```

---

### Task 9: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md` (new section)
- Modify: `new/docs/technical-design/pending-tasks.md` (check off Phase 1 item 3, remove it from
  the Dependencies section since it's no longer blocked/pending)
- Modify: `new/docs/technical-design/review-comments.md` (mark the relevant finding resolved, don't
  delete it)

**Interfaces:**
- Consumes: nothing (last task)
- Produces: nothing

- [ ] **Step 1: Add a "Database-Enforced Tenant Isolation" section to `Development-Standards.md`**

Add a new numbered section after the existing "Module Boundaries" section, covering: per-tenant
`NOLOGIN` roles + `SET LOCAL ROLE` inside a real transaction (not just `search_path`), why
`ALTER DEFAULT PRIVILEGES` plus an explicit initial grant are both needed, the
`PLATFORM_MIGRATIONS`/`TENANT_MIGRATIONS` split and where each runs, the `migrate-tenants` runner
and when to run it (after adding any new tenant-scoped migration), and a link to
`new/docs/superpowers/plans/2026-08-04-database-enforced-tenant-isolation.md` for the full
implementation history.

- [ ] **Step 2: Check off `pending-tasks.md` Phase 1 item 3**

Change:

```markdown
3. **Database-enforced tenant isolation** (new-features.md #2) — defense-in-depth: catches
   tenant-resolution bugs even after item 2 lands. **Blocked on the parked tenant-migration-runner
   gap** (see Dependencies below) — new schema grants can't be rolled out to already-provisioned
   tenants without one.
```

to:

```markdown
3. [x] **Database-enforced tenant isolation** (new-features.md #2) — done: per-tenant `NOLOGIN`
   Postgres roles + schema grants, `SET LOCAL ROLE` inside a real transaction in
   `TenantConnectionService`, a real production tenant-provisioning path (didn't exist before this
   item), and the `migrate-tenants` backfill runner that closed the dependency below.
```

And remove the now-resolved bullet from the "Dependencies worth calling out explicitly" section at
the bottom of the file (the one starting "**Phase 1, item 3** (DB-enforced tenant isolation)
depends on solving the tenant-migration-runner gap first...").

- [ ] **Step 3: Update the `review-comments.md` finding**

Find the finding discussing tenant isolation being documented as Postgres-role-enforced but
implemented as a single shared role (search for "single DB user" or "search_path" in the High
findings near the top of the file) and add directly under its heading:

```markdown
**Resolved:** Per-tenant Postgres roles + schema grants, `SET LOCAL ROLE` inside a real
transaction, and a real tenant-provisioning path now exist; see
`new/docs/superpowers/plans/2026-08-04-database-enforced-tenant-isolation.md`.
```

- [ ] **Step 4: Run the full suite one last time**

```bash
pnpm exec nx run-many -t typecheck test lint
```

- [ ] **Step 5: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md new/docs/technical-design/review-comments.md
git commit -m "docs: document database-enforced tenant isolation, check off Phase 1 item 3"
```
