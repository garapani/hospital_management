# Identity & Access Service — Core Auth & RBAC Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Identity & Access Service as a real NestJS application with a real Postgres-backed platform-level RBAC catalog and a tenant-scoped accounts table, implementing staff username/password login with JWT issuance and account lockout, end-to-end.

**Architecture:** A new Nx application (`apps/identity-access`) using a hand-managed TypeORM `DataSource` (not `@nestjs/typeorm`'s module, since per-request schema switching doesn't fit that module's single-connection assumption). Platform-level RBAC tables (`roles`, `permissions`, `role_permissions`) live in the default (`public`) schema, queried directly. Tenant-scoped tables (`accounts`, `account_roles`) live inside `tenant_<hospitalId>` schemas, queried exclusively through a `TenantConnectionService` that sets `search_path` per query using a validated schema name from `@hospital/tenant-context`.

**Tech Stack:** NestJS, TypeORM, `pg`, `bcryptjs` (pure JS, avoids native-build friction), `@nestjs/jwt`, `tsx` (runs TypeScript migration/seed scripts directly under NodeNext ESM without a separate compile step), Postgres 16 via Docker Compose (local dev/test only).

## Global Constraints

- Node 20 LTS, pnpm, Nx (`new/code/`).
- All relative imports use explicit `.js` extensions (NodeNext module resolution) — see `new/code/CLAUDE.md`.
- ESM has no `__dirname`/`__filename` — use `fileURLToPath(import.meta.url)` + `node:path` instead, anywhere a file-relative path is needed.
- `experimentalDecorators`/`emitDecoratorMetadata` are already enabled in `tsconfig.base.json` — no further tsconfig changes needed for this plan (no new hook-protected-file edits expected).
- Never `git commit --amend`; never a `Co-Authored-By: Claude` trailer.
- Password hashing: bcrypt-family (`bcryptjs`), never plaintext, never the old system's reversible scheme.
- JWT access token ~15 minutes, refresh token ~7–30 days (this plan issues both as JSON in the response body — Gateway, a future service, is responsible for translating this into httpOnly cookies for browsers; Identity & Access's own HTTP contract stays cookie-agnostic).
- Lockout: 5 failed login attempts → 15 minute lock, per account.
- JWT claims: `sub` (accountId), `roles[]`, `permissions[]`, `hospitalId`, `exp` (per PRD §6.2; `patientId` is out of scope for this plan — no patient auth here).

## Explicitly Deferred (follow-up plans, once their dependencies exist)

- Patient phone+OTP authentication (needs Notification Service for SMS).
- Admin unlock endpoint and forced password-change flow (`needs_password_update` — the column exists per the design spec, but no endpoint enforces it yet in this plan; deferred alongside the full accounts/roles HTTP admin API for the User & Role Management screen).
- The `rbac.changed` RabbitMQ event (no broker running anywhere in this repo yet).
- Reacting to a real `tenant.provisioned` event (no System Admin Service exists yet to publish it). This plan creates tenant schemas via a direct, parameterized method instead of an event consumer.
- Multi-role, time-bound (`start_date`/`end_date`) role assignment enforcement — this plan assigns exactly one role at account-creation time; the full `account_roles` time-window logic is deferred with the admin API above.

---

## File Structure

```
new/code/
  docker-compose.dev.yml                          # local Postgres for identity-access, dev/test only
  apps/
    identity-access/
      src/
        main.ts
        app/
          app.module.ts
        database/
          data-source.ts                          # TypeORM DataSource factory
          migrate.ts                               # runs pending migrations via tsx
          tenant-connection.service.ts             # per-request search_path switching
          tenant-connection.service.integration-spec.ts
          migrations/
            1738200000000-create-rbac-catalog-tables.ts
            1738200000001-create-tenant-account-tables.ts
        rbac/
          entities/role.entity.ts
          entities/permission.entity.ts
          entities/role-permission.entity.ts
          seed-rbac-catalog.ts
          seed-rbac-catalog.integration-spec.ts
        accounts/
          entities/account.entity.ts
          entities/account-role.entity.ts
          accounts.service.ts
          accounts.service.integration-spec.ts
          accounts.module.ts
        auth/
          auth.service.ts
          auth.service.integration-spec.ts
          auth.controller.ts
          auth.controller.integration-spec.ts
          auth.module.ts
          dto/login.dto.ts
```

Tests suffixed `.integration-spec.ts` require the Docker Compose Postgres to be running (`docker compose -f new/code/docker-compose.dev.yml up -d` from `new/code/`) — they exercise real schema creation and real queries, which is the only meaningful way to test tenant isolation and migrations.

---

### Task 1: Local Postgres Dev/Test Infrastructure

**Files:**
- Create: `new/code/docker-compose.dev.yml`

**Interfaces:**
- Produces: a Postgres 16 instance reachable at `localhost:5433`, database `identity_access`, user `identity_access` / password `identity_access_dev_password`. Every later task's integration tests connect here.

- [ ] **Step 1: Write the Compose file**

Create `new/code/docker-compose.dev.yml`:

```yaml
services:
  identity-access-postgres:
    image: postgres:16-alpine
    container_name: identity-access-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - identity-access-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  identity-access-postgres-data:
```

- [ ] **Step 2: Start it and verify it's healthy**

```bash
cd new/code
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml exec -T identity-access-postgres up 2>/dev/null; \
docker compose -f docker-compose.dev.yml exec -T identity-access-postgres pg_isready -U identity_access
```

Expected: `/var/run/postgresql:5432 - accepting connections` (container service name is `identity-access-postgres` — the `container_name` field is just a friendly label, Compose commands address services by their top-level key).

- [ ] **Step 3: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/docker-compose.dev.yml
git commit -m "chore: add local Postgres dev/test compose file for identity-access"
```

---

### Task 2: NestJS App Scaffold + TypeORM DataSource Wiring

**Files:**
- Create: `apps/identity-access/` (generated)
- Create: `new/code/apps/identity-access/src/database/data-source.ts`
- Create: `new/code/apps/identity-access/src/database/migrate.ts`

**Interfaces:**
- Produces: `createDataSource(): DataSource` and a singleton `dataSource: DataSource`, both with empty `entities`/`migrations` arrays for now — Tasks 4 and 5 add to these arrays.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Generate the application**

```bash
cd new/code
pnpm exec nx g @nx/nest:application identity-access --directory=apps/identity-access --e2eTestRunner=none --unitTestRunner=jest
```

- [ ] **Step 2: Add dependencies**

```bash
pnpm add typeorm pg bcryptjs @nestjs/jwt
pnpm add -D @types/pg @types/bcryptjs tsx
```

- [ ] **Step 3: Write the DataSource factory**

Create `new/code/apps/identity-access/src/database/data-source.ts`:

```typescript
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [],
    migrations: [],
    synchronize: false,
  });
}

export const dataSource = createDataSource();
```

- [ ] **Step 4: Write the migration runner script**

Create `new/code/apps/identity-access/src/database/migrate.ts`:

```typescript
import { dataSource } from './data-source.js';

async function main(): Promise<void> {
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 5: Verify the app boots and the DataSource connects**

Requires Task 1's Postgres running.

```bash
cd new/code
pnpm exec tsx apps/identity-access/src/database/migrate.ts
```

Expected: exits 0 with no error (there are no migrations registered yet, so this just proves the connection succeeds — `dataSource.initialize()` would throw on a connection failure).

- [ ] **Step 6: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access new/code/package.json new/code/pnpm-lock.yaml
git commit -m "feat: scaffold identity-access Nx application with TypeORM DataSource"
```

---

### Task 3: TenantConnectionService — Tenant-Scoped Query Execution

**Files:**
- Create: `new/code/apps/identity-access/src/database/tenant-connection.service.ts`
- Test: `new/code/apps/identity-access/src/database/tenant-connection.service.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantContextService` from `@hospital/tenant-context` (`getSchemaName()`), `DataSource` from Task 2.
- Produces: `TenantConnectionService.runInTenantSchema<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>`. Every later task that touches tenant-scoped tables (`accounts`, `account_roles`) goes through this — never a direct `dataSource.getRepository(...)` call for those entities.

This is the foundational multi-tenancy correctness piece: it validates the schema name (defense against SQL injection via `SET search_path`, since identifiers can't be parameterized) and proves — with a real integration test against two real schemas — that one tenant's query can never see another's data. This test **is** the cross-tenant leakage guarantee the design spec requires, verified at the lowest possible layer rather than only through a higher-level HTTP test.

- [ ] **Step 1: Write the failing integration test**

Create `new/code/apps/identity-access/src/database/tenant-connection.service.integration-spec.ts`:

```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';

describe('TenantConnectionService (integration)', () => {
  const dataSource = createDataSource();
  let tenantContext: TenantContextService;
  let service: TenantConnectionService;

  beforeAll(async () => {
    await dataSource.initialize();
    tenantContext = new TenantContextService();
    service = new TenantConnectionService(dataSource, tenantContext);

    for (const schema of ['tenant_test_a', 'tenant_test_b']) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dataSource.query(`CREATE SCHEMA "${schema}"`);
      await dataSource.query(
        `CREATE TABLE "${schema}".probe (id serial primary key, label text not null)`,
      );
    }
    await dataSource.query(`INSERT INTO tenant_test_a.probe (label) VALUES ('a-row')`);
    await dataSource.query(`INSERT INTO tenant_test_b.probe (label) VALUES ('b-row')`);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_a" CASCADE`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_b" CASCADE`);
    await dataSource.destroy();
  });

  it('only sees the current tenant context schema\'s data', async () => {
    const rowsForA = await tenantContext.run(
      { tenantId: 'test_a', correlationId: 'c1' },
      () => service.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForA).toEqual([{ label: 'a-row' }]);

    const rowsForB = await tenantContext.run(
      { tenantId: 'test_b', correlationId: 'c2' },
      () => service.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForB).toEqual([{ label: 'b-row' }]);
  });

  it('throws when no tenant context is set', async () => {
    await expect(service.runInTenantSchema((manager) => manager.query('SELECT 1'))).rejects.toThrow(
      'No tenant context set',
    );
  });

  it('rejects a schema name that is not safe to interpolate into SQL', async () => {
    await expect(
      tenantContext.run({ tenantId: 'bad"; DROP TABLE probe; --', correlationId: 'c3' }, () =>
        service.runInTenantSchema((manager) => manager.query('SELECT 1')),
      ),
    ).rejects.toThrow('Refusing to use unsafe schema name');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Requires Task 1's Postgres running.

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=tenant-connection
```

Expected: FAIL — `tenant-connection.service` module not found.

- [ ] **Step 3: Implement `TenantConnectionService`**

Create `new/code/apps/identity-access/src/database/tenant-connection.service.ts`:

```typescript
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

  async runInTenantSchema<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const schemaName = this.tenantContext.getSchemaName();
    if (!schemaName) {
      throw new Error('No tenant context set — cannot resolve a schema for this query.');
    }
    if (!SAFE_SCHEMA_NAME.test(schemaName)) {
      throw new Error(`Refusing to use unsafe schema name: ${schemaName}`);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`SET search_path TO "${schemaName}", public`);
      return await work(queryRunner.manager);
    } finally {
      await queryRunner.release();
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPattern=tenant-connection
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/database/tenant-connection.service.ts new/code/apps/identity-access/src/database/tenant-connection.service.integration-spec.ts
git commit -m "feat: add TenantConnectionService with schema-name validation and cross-tenant isolation test"
```

---

### Task 4: Platform RBAC Catalog — Entities, Migration, Seed

**Files:**
- Create: `new/code/apps/identity-access/src/rbac/entities/role.entity.ts`
- Create: `new/code/apps/identity-access/src/rbac/entities/permission.entity.ts`
- Create: `new/code/apps/identity-access/src/rbac/entities/role-permission.entity.ts`
- Create: `new/code/apps/identity-access/src/database/migrations/1738200000000-create-rbac-catalog-tables.ts`
- Create: `new/code/apps/identity-access/src/rbac/seed-rbac-catalog.ts`
- Test: `new/code/apps/identity-access/src/rbac/seed-rbac-catalog.integration-spec.ts`
- Modify: `new/code/apps/identity-access/src/database/data-source.ts`

**Interfaces:**
- Produces: `Role`, `Permission`, `RolePermission` entity classes; `seedRbacCatalog(dataSource: DataSource): Promise<void>`, idempotent (safe to run more than once). Task 7 (`AuthService`) reads `Role`/`RolePermission`/`Permission` directly via the plain `dataSource` (platform-level data, not tenant-scoped, so it does not go through `TenantConnectionService`).

These tables live in the `public` schema (platform-level, shared across all tenants — per the design spec's departure from the old model, the 13-role catalog from PRD §6.1 is fixed and identical for every hospital).

- [ ] **Step 1: Write the entities**

Create `new/code/apps/identity-access/src/rbac/entities/role.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('roles')
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column()
  description!: string;

  @Column({ type: 'int', default: 0 })
  priority!: number;

  @Column({ default: false })
  bypassesPermissionChecks!: boolean;

  @Column({ default: false })
  isCrossTenant!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}
```

Create `new/code/apps/identity-access/src/rbac/entities/permission.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column()
  description!: string;

  @Column({ default: true })
  isActive!: boolean;
}
```

Create `new/code/apps/identity-access/src/rbac/entities/role-permission.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('role_permissions')
export class RolePermission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  roleId!: string;

  @Column()
  permissionId!: string;
}
```

- [ ] **Step 2: Write the migration**

Create `new/code/apps/identity-access/src/database/migrations/1738200000000-create-rbac-catalog-tables.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbacCatalogTables1738200000000 implements MigrationInterface {
  name = 'CreateRbacCatalogTables1738200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL,
        priority integer NOT NULL DEFAULT 0,
        "bypassesPermissionChecks" boolean NOT NULL DEFAULT false,
        "isCrossTenant" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(`
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(`
      CREATE TABLE role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "roleId" uuid NOT NULL REFERENCES roles(id),
        "permissionId" uuid NOT NULL REFERENCES permissions(id)
      )
    `);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE role_permissions`);
    await queryRunner.query(`DROP TABLE permissions`);
    await queryRunner.query(`DROP TABLE roles`);
  }
}
```

Note: `gen_random_uuid()` requires the `pgcrypto` extension — created at the end of `up()` so it exists before any insert relies on the column default (extension creation is idempotent via `IF NOT EXISTS` and order-independent relative to table creation here since no rows are inserted in this migration).

- [ ] **Step 3: Register the entity and migration in the DataSource**

Modify `new/code/apps/identity-access/src/database/data-source.ts`:

```typescript
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { CreateRbacCatalogTables1738200000000 } from './migrations/1738200000000-create-rbac-catalog-tables.js';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [Role, Permission, RolePermission],
    migrations: [CreateRbacCatalogTables1738200000000],
    synchronize: false,
  });
}

export const dataSource = createDataSource();
```

- [ ] **Step 4: Run the migration against the dev database**

```bash
cd new/code
pnpm exec tsx apps/identity-access/src/database/migrate.ts
```

Expected: exits 0; verify with `docker compose -f docker-compose.dev.yml exec -T identity-access-postgres psql -U identity_access -c '\dt'` showing `roles`, `permissions`, `role_permissions`, `migrations`.

- [ ] **Step 5: Write the failing seed test**

Create `new/code/apps/identity-access/src/rbac/seed-rbac-catalog.integration-spec.ts`:

```typescript
import { createDataSource } from '../database/data-source.js';
import { Role } from './entities/role.entity.js';
import { seedRbacCatalog } from './seed-rbac-catalog.js';

describe('seedRbacCatalog (integration)', () => {
  const dataSource = createDataSource();

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM role_permissions');
    await dataSource.query('DELETE FROM permissions');
    await dataSource.query('DELETE FROM roles');
  });

  it('creates the fixed 13-role platform catalog', async () => {
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find();
    expect(roles).toHaveLength(13);
    expect(roles.map((r) => r.name)).toEqual(
      expect.arrayContaining(['Super Admin', 'Hospital Admin', 'Doctor', 'Patient']),
    );
  });

  it('marks Super Admin as bypassing checks and cross-tenant', async () => {
    await seedRbacCatalog(dataSource);
    const superAdmin = await dataSource.getRepository(Role).findOneOrFail({
      where: { name: 'Super Admin' },
    });
    expect(superAdmin.bypassesPermissionChecks).toBe(true);
    expect(superAdmin.isCrossTenant).toBe(true);
  });

  it('is idempotent — running it twice does not duplicate roles', async () => {
    await seedRbacCatalog(dataSource);
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find();
    expect(roles).toHaveLength(13);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
pnpm exec nx test identity-access --testPathPattern=seed-rbac-catalog
```

Expected: FAIL — `seed-rbac-catalog` module not found.

- [ ] **Step 7: Implement the seed script**

Create `new/code/apps/identity-access/src/rbac/seed-rbac-catalog.ts`:

```typescript
import { DataSource } from 'typeorm';
import { Role } from './entities/role.entity.js';

interface RoleSeed {
  name: string;
  description: string;
  priority: number;
  bypassesPermissionChecks: boolean;
  isCrossTenant: boolean;
}

const ROLE_CATALOG: RoleSeed[] = [
  {
    name: 'Super Admin',
    description: 'Cross-hospital vendor/ops access to every service and tenant.',
    priority: 100,
    bypassesPermissionChecks: true,
    isCrossTenant: true,
  },
  {
    name: 'Hospital Admin',
    description: 'Full access within a single hospital tenant.',
    priority: 90,
    bypassesPermissionChecks: true,
    isCrossTenant: false,
  },
  {
    name: 'Receptionist / Front Desk',
    description: 'Patient registration, scheduling, and charge capture.',
    priority: 50,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Doctor',
    description: 'Clinical documentation, ordering, and scheduling for own patients.',
    priority: 60,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Nurse',
    description: 'Nursing tasks, vitals/MAR, and ward-scoped admission access.',
    priority: 55,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Lab Technician',
    description: 'Lab test catalog, sample tracking, and results entry.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Radiology Technician',
    description: 'Imaging orders and DICOM report generation.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Pharmacist',
    description: 'Drug dispensing, sales, and rack/bin management.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Billing/Accounts Staff',
    description: 'Charge capture, invoicing, insurance, and accounting.',
    priority: 45,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Inventory/Store Manager',
    description: 'Stock, goods receipt, and fixed-asset management.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'HR/Payroll Admin',
    description: 'Employee records, payroll, and incentive calculation.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Helpdesk Agent',
    description: 'Internal ticketing.',
    priority: 20,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Auditor/Compliance',
    description: 'Read-only access to audit trail and reporting.',
    priority: 30,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
];

export async function seedRbacCatalog(dataSource: DataSource): Promise<void> {
  const repository = dataSource.getRepository(Role);
  for (const roleSeed of ROLE_CATALOG) {
    const existing = await repository.findOne({ where: { name: roleSeed.name } });
    if (existing) {
      continue;
    }
    await repository.save(repository.create(roleSeed));
  }
}
```

Note: this seeds 13 roles per PRD §6.1's table, but omits the `Patient` role from the table above by mistake — re-check: PRD §6.1 lists Super Admin, Hospital Admin, Receptionist, Doctor, Nurse, Lab Technician, Radiology Technician, Pharmacist, Billing/Accounts Staff, Inventory/Store Manager, HR/Payroll Admin, Helpdesk Agent, Auditor/Compliance, **Patient** — that's 14, not 13. Add the missing role to `ROLE_CATALOG`:

```typescript
  {
    name: 'Patient',
    description: 'Self-service portal access to own records only.',
    priority: 10,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
```

And update the test's expectation in Step 5 from `toHaveLength(13)` to `toHaveLength(14)` in both places before running Step 8.

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPattern=seed-rbac-catalog
```

Expected: PASS, 3 tests, 14 roles.

- [ ] **Step 9: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/rbac new/code/apps/identity-access/src/database/data-source.ts new/code/apps/identity-access/src/database/migrations
git commit -m "feat: add platform RBAC catalog entities, migration, and seed (14 roles per PRD §6.1)"
```

---

### Task 5: Tenant Account Entities + Migration

**Files:**
- Create: `new/code/apps/identity-access/src/accounts/entities/account.entity.ts`
- Create: `new/code/apps/identity-access/src/accounts/entities/account-role.entity.ts`
- Create: `new/code/apps/identity-access/src/database/migrations/1738200000001-create-tenant-account-tables.ts`
- Modify: `new/code/apps/identity-access/src/database/data-source.ts`

**Interfaces:**
- Produces: `Account`, `AccountRole` entity classes. A migration that creates `accounts`/`account_roles` inside **whichever schema is current on the connection it runs against** — this migration is applied once per tenant schema (there is no reactive `tenant.provisioned` consumer in this plan; Task 6's tests create tenant schemas directly by calling a small helper that runs this same migration's `up()` against a freshly created schema).
- Consumes: `TenantConnectionService` is NOT used to run migrations (migrations run with an explicit `search_path`, set directly on the raw connection before `up()` executes) — only real query work (Task 6 onward) goes through `TenantConnectionService`.

- [ ] **Step 1: Write the entities**

Create `new/code/apps/identity-access/src/accounts/entities/account.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  accountType!: 'staff' | 'patient';

  @Column()
  displayName!: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  needsPasswordUpdate!: boolean;

  @Column({ type: 'int', default: 0 })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true })
  lockedUntil!: Date | null;

  @Column({ type: 'varchar', unique: true, nullable: true })
  username!: string | null;

  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'varchar', nullable: true })
  phoneNumber!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  phoneVerifiedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
```

Create `new/code/apps/identity-access/src/accounts/entities/account-role.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_roles')
export class AccountRole {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  accountId!: string;

  @Column()
  roleId!: string;

  @Column({ type: 'timestamptz', nullable: true })
  startDate!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endDate!: Date | null;

  @Column({ default: true })
  isActive!: boolean;
}
```

- [ ] **Step 2: Write the migration**

Create `new/code/apps/identity-access/src/database/migrations/1738200000001-create-tenant-account-tables.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantAccountTables1738200000001 implements MigrationInterface {
  name = 'CreateTenantAccountTables1738200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountType" varchar(20) NOT NULL,
        "displayName" varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "needsPasswordUpdate" boolean NOT NULL DEFAULT false,
        "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        "lockedUntil" timestamptz NULL,
        username varchar UNIQUE NULL,
        email varchar NULL,
        "passwordHash" varchar NULL,
        "phoneNumber" varchar NULL,
        "phoneVerifiedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE account_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountId" uuid NOT NULL REFERENCES accounts(id),
        "roleId" uuid NOT NULL,
        "startDate" timestamptz NULL,
        "endDate" timestamptz NULL,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE account_roles`);
    await queryRunner.query(`DROP TABLE accounts`);
  }
}
```

Note: `account_roles."roleId"` has no foreign key — `roles` lives in a different schema (`public`) from `account_roles` (`tenant_<id>`), and Postgres foreign keys cannot cross schemas cleanly in a way that stays correct if a tenant schema is ever restored independently. Referential correctness for `roleId` is enforced at the application layer (`AccountsService`, Task 6), not the database layer — consistent with the design spec's "opaque ID reference, not a live FK" pattern already used between other services.

- [ ] **Step 3: Register the entity in the DataSource**

Modify `new/code/apps/identity-access/src/database/data-source.ts` — add the imports and extend the `entities` array (the migration itself is intentionally **not** added to the `migrations` array, since it must run per-tenant-schema on demand, not once globally on the default connection — see Task 6's `provisionTenantSchema` helper):

```typescript
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
```

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole],
```

- [ ] **Step 4: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/entities new/code/apps/identity-access/src/database/migrations new/code/apps/identity-access/src/database/data-source.ts
git commit -m "feat: add tenant-scoped Account/AccountRole entities and per-schema migration"
```

---

### Task 6: AccountsService — Tenant Provisioning Helper, Create, Find

**Files:**
- Create: `new/code/apps/identity-access/src/accounts/accounts.service.ts`
- Create: `new/code/apps/identity-access/src/accounts/accounts.module.ts`
- Test: `new/code/apps/identity-access/src/accounts/accounts.service.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantConnectionService` (Task 3), `Account`/`AccountRole` entities (Task 5), `Role` entity (Task 4, read via the plain `DataSource`), `bcryptjs`.
- Produces: `AccountsService.provisionTenantSchema(dataSource: DataSource, tenantId: string): Promise<void>` (test helper — creates a `tenant_<id>` schema and runs the account-tables migration's `up()` against it directly, standing in for the deferred `tenant.provisioned` event consumer). `AccountsService.createStaffAccount({ tenantId, username, email, displayName, password, roleName }): Promise<Account>`. `AccountsService.findByUsernameWithRoles(tenantId: string, username: string): Promise<{ account: Account; roleNames: string[] } | null>`.

- [ ] **Step 1: Write the failing test**

Create `new/code/apps/identity-access/src/accounts/accounts.service.integration-spec.ts`:

```typescript
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from './accounts.service.js';

describe('AccountsService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);

  beforeAll(async () => {
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_accounts');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_accounts" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_accounts', correlationId: 'test' }, work);
  }

  it('creates a staff account with a hashed password and an assigned role', async () => {
    const account = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'dr.alice',
        email: 'alice@example.com',
        displayName: 'Dr. Alice',
        password: 'correct horse battery staple',
        roleName: 'Doctor',
      }),
    );

    expect(account.username).toBe('dr.alice');
    expect(account.passwordHash).not.toBe('correct horse battery staple');
    expect(await bcrypt.compare('correct horse battery staple', account.passwordHash as string)).toBe(
      true,
    );
  });

  it('finds an account by username together with its active role names', async () => {
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'nurse.bob',
        email: 'bob@example.com',
        displayName: 'Nurse Bob',
        password: 'another-strong-password',
        roleName: 'Nurse',
      }),
    );

    const found = await inTenant(() => accountsService.findByUsernameWithRoles('nurse.bob'));

    expect(found?.account.username).toBe('nurse.bob');
    expect(found?.roleNames).toEqual(['Nurse']);
  });

  it('returns null for a username that does not exist', async () => {
    const found = await inTenant(() => accountsService.findByUsernameWithRoles('nobody'));
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=accounts.service
```

Expected: FAIL — `accounts.service` module not found.

- [ ] **Step 3: Implement `AccountsService`**

Create `new/code/apps/identity-access/src/accounts/accounts.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Account } from './entities/account.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import { Role } from '../rbac/entities/role.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreateTenantAccountTables1738200000001 } from '../database/migrations/1738200000001-create-tenant-account-tables.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;
const BCRYPT_SALT_ROUNDS = 12;

export interface CreateStaffAccountInput {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roleName: string;
}

export interface AccountWithRoles {
  account: Account;
  roleNames: string[];
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Test/dev-only stand-in for the deferred `tenant.provisioned` event consumer:
   * creates the tenant schema and runs the account-tables migration against it directly.
   */
  async provisionTenantSchema(dataSource: DataSource, tenantId: string): Promise<void> {
    if (!SAFE_TENANT_ID.test(tenantId)) {
      throw new Error(`Refusing to provision unsafe tenant id: ${tenantId}`);
    }
    const schemaName = `tenant_${tenantId}`;
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      await queryRunner.query(`SET search_path TO "${schemaName}", public`);
      const migration = new CreateTenantAccountTables1738200000001();
      await migration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async createStaffAccount(input: CreateStaffAccountInput): Promise<Account> {
    const role = await this.dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: input.roleName } });
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const account = await manager.getRepository(Account).save(
        manager.getRepository(Account).create({
          accountType: 'staff',
          username: input.username,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
        }),
      );
      await manager.getRepository(AccountRole).save(
        manager.getRepository(AccountRole).create({
          accountId: account.id,
          roleId: role.id,
        }),
      );
      return account;
    });
  }

  async findByUsernameWithRoles(username: string): Promise<AccountWithRoles | null> {
    const account = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).findOne({ where: { username } }),
    );
    if (!account) {
      return null;
    }

    const accountRoles = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(AccountRole).find({ where: { accountId: account.id, isActive: true } }),
    );
    const roleIds = accountRoles.map((accountRole) => accountRole.roleId);
    const roles =
      roleIds.length === 0
        ? []
        : await this.dataSource.getRepository(Role).findByIds(roleIds);

    return { account, roleNames: roles.map((role) => role.name) };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPattern=accounts.service
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the module**

Create `new/code/apps/identity-access/src/accounts/accounts.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';

@Module({
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts
git commit -m "feat: add AccountsService with tenant provisioning helper, staff account creation, and lookup by username"
```

---

### Task 7: AuthService — Login, JWT Issuance, Lockout

**Files:**
- Create: `new/code/apps/identity-access/src/auth/auth.service.ts`
- Create: `new/code/apps/identity-access/src/auth/auth.module.ts`
- Test: `new/code/apps/identity-access/src/auth/auth.service.integration-spec.ts`

**Interfaces:**
- Consumes: `AccountsService` (Task 6), `TenantConnectionService` (Task 3), `Role`/`Permission`/`RolePermission` entities (Task 4), `@nestjs/jwt`'s `JwtService`.
- Produces: `AuthService.login({ tenantId, username, password }): Promise<LoginResult>` where `LoginResult = { accessToken: string; refreshToken: string } | { locked: true; retryAfterSeconds: number } | { invalidCredentials: true }`. Task 8's controller maps this discriminated result to HTTP status codes.

- [ ] **Step 1: Write the failing test**

Create `new/code/apps/identity-access/src/auth/auth.service.integration-spec.ts`:

```typescript
import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const jwtService = new JwtService({ secret: 'test-secret' });
  const authService = new AuthService(accountsService, jwtService, tenantContext);

  beforeAll(async () => {
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_auth');
    await tenantContext.run({ tenantId: 'test_auth', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'dr.carol',
        email: 'carol@example.com',
        displayName: 'Dr. Carol',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_auth" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_auth', correlationId: 'test' }, work);
  }

  it('issues an access and refresh token for correct credentials', async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['roles']).toEqual(['Doctor']);
    expect(decoded['hospitalId']).toBe('test_auth');
  });

  it('returns invalidCredentials for a wrong password without revealing which field was wrong', async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'wrong-password' }),
    );
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('returns invalidCredentials for a username that does not exist', async () => {
    const result = await inTenant(() => authService.login({ username: 'nobody', password: 'x' }));
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('locks the account after 5 failed attempts and reports the remaining lock time', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await inTenant(() => authService.login({ username: 'dr.carol', password: 'wrong-password' }));
    }

    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ locked: true });
    expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=auth.service
```

Expected: FAIL — `auth.service` module not found.

- [ ] **Step 3: Implement `AuthService`**

Create `new/code/apps/identity-access/src/auth/auth.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface LoginInput {
  username: string;
  password: string;
}

export type LoginResult =
  | { accessToken: string; refreshToken: string }
  | { locked: true; retryAfterSeconds: number }
  | { invalidCredentials: true };

@Injectable()
export class AuthService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const found = await this.accountsService.findByUsernameWithRoles(input.username);
    if (!found) {
      return { invalidCredentials: true };
    }

    const { account, roleNames } = found;

    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 1000);
      return { locked: true, retryAfterSeconds };
    }

    const passwordMatches =
      account.passwordHash !== null && (await bcrypt.compare(input.password, account.passwordHash));

    if (!passwordMatches) {
      await this.accountsService.recordFailedLogin(account.id);
      const updatedAttempts = account.failedLoginAttempts + 1;
      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.accountsService.lockAccount(account.id, new Date(Date.now() + LOCKOUT_DURATION_MS));
      }
      return { invalidCredentials: true };
    }

    await this.accountsService.resetFailedLogins(account.id);

    const hospitalId = this.tenantContext.getTenantId();
    const payload = {
      sub: account.id,
      roles: roleNames,
      permissions: [] as string[],
      hospitalId,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.jwtService.signAsync(
      { sub: account.id, hospitalId },
      { expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken };
  }
}
```

Note: `permissions: []` is a placeholder for a real role→permission resolution — no permissions are seeded against any role in this plan (that's the follow-up admin-API plan's job, once real routes across services need real permission names). Documented here so the empty array isn't mistaken for a bug later.

- [ ] **Step 4: Add the three `AccountsService` methods the test above requires**

Modify `new/code/apps/identity-access/src/accounts/accounts.service.ts` — add these three methods to the `AccountsService` class (after `findByUsernameWithRoles`):

```typescript
  async recordFailedLogin(accountId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(Account)
        .increment({ id: accountId }, 'failedLoginAttempts', 1),
    );
  }

  async lockAccount(accountId: string, lockedUntil: Date): Promise<void> {
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).update({ id: accountId }, { lockedUntil }),
    );
  }

  async resetFailedLogins(accountId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(Account)
        .update({ id: accountId }, { failedLoginAttempts: 0, lockedUntil: null }),
    );
  }
```

Also update `findByUsernameWithRoles`'s returned `account` object: since `AuthService.login` reads `account.lockedUntil` and `account.failedLoginAttempts` immediately after the lookup, no further change to `findByUsernameWithRoles` itself is needed — it already returns the full `Account` entity.

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPattern="auth.service|accounts.service"
```

Expected: PASS — 4 tests in `auth.service`, 3 tests in `accounts.service` (unaffected by the additions), no regressions.

- [ ] **Step 6: Write the module**

Create `new/code/apps/identity-access/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    AccountsModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-in-production',
    }),
  ],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 7: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/auth new/code/apps/identity-access/src/accounts/accounts.service.ts
git commit -m "feat: add AuthService with JWT issuance and 5-attempt/15-minute lockout"
```

---

### Task 8: AuthController — HTTP Login Endpoint

**Files:**
- Create: `new/code/apps/identity-access/src/auth/dto/login.dto.ts`
- Create: `new/code/apps/identity-access/src/auth/auth.controller.ts`
- Test: `new/code/apps/identity-access/src/auth/auth.controller.integration-spec.ts`
- Modify: `new/code/apps/identity-access/src/auth/auth.module.ts`
- Modify: `new/code/apps/identity-access/src/app/app.module.ts`

**Interfaces:**
- Consumes: `AuthService` (Task 7), Express `Request` for the `x-tenant-id` header (the Gateway forwards this in production; the test sets it directly since Gateway doesn't exist yet).
- Produces: `POST /auth/login` — `200 { accessToken, refreshToken }` on success, `401 { message: "Invalid username or password" }` on bad credentials, `423 { message: "Account locked", retryAfterSeconds }` when locked.

- [ ] **Step 1: Write the DTO**

Create `new/code/apps/identity-access/src/auth/dto/login.dto.ts`:

```typescript
export class LoginDto {
  username!: string;
  password!: string;
}
```

- [ ] **Step 2: Write the failing controller test**

Create `new/code/apps/identity-access/src/auth/auth.controller.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthModule } from './auth.module.js';

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_controller');
    await tenantContext.run({ tenantId: 'test_controller', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'dr.dave',
        email: 'dave@example.com',
        displayName: 'Dr. Dave',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(TenantContextService)
      .useValue(tenantContext)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_controller" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('returns tokens for correct credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_controller')
      .send({ username: 'dr.dave', password: 'correct-password-123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
  });

  it('returns 401 with a generic message for wrong credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_controller')
      .send({ username: 'dr.dave', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid username or password');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=auth.controller
```

Expected: FAIL — `auth.controller` module not found. (Also install `supertest`: `pnpm add -D supertest @types/supertest` before running.)

- [ ] **Step 4: Implement `AuthController`**

Create `new/code/apps/identity-access/src/auth/auth.controller.ts`:

```typescript
import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body);

    if ('accessToken' in result) {
      return result;
    }

    if ('locked' in result) {
      res.status(HttpStatus.LOCKED);
      return { message: 'Account locked', retryAfterSeconds: result.retryAfterSeconds };
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid username or password' };
  }
}
```

- [ ] **Step 5: Register the controller and the `DataSource`/`TenantContextService` providers**

Modify `new/code/apps/identity-access/src/auth/auth.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { TenantContextModule, TenantContextService } from '@hospital/tenant-context';
import { AccountsModule } from '../accounts/accounts.module.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { createDataSource } from '../database/data-source.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    TenantContextModule,
    AccountsModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-in-production',
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TenantConnectionService,
    {
      provide: DataSource,
      useFactory: async () => {
        const ds = createDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
```

Note: `AccountsModule` also needs `TenantConnectionService` and `DataSource` as providers for `AccountsService`'s constructor to resolve — add the same two providers there too:

Modify `new/code/apps/identity-access/src/accounts/accounts.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { createDataSource } from '../database/data-source.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [TenantContextModule],
  providers: [
    AccountsService,
    TenantConnectionService,
    {
      provide: DataSource,
      useFactory: async () => {
        const ds = createDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
```

Since both modules now provide `DataSource` via the same factory, and `AuthModule` imports `AccountsModule`, Nest will treat these as two separate provider registrations in two different module scopes unless `AccountsModule` exports `DataSource` too — export it from `AccountsModule` (`exports: [AccountsService, DataSource, TenantConnectionService]`) and remove the duplicate `DataSource`/`TenantConnectionService` providers from `AuthModule`, keeping only `AuthService` there, so there is exactly one `DataSource` instance shared across the whole app.

- [ ] **Step 6: Wire `AuthModule` into `AppModule`**

Modify `new/code/apps/identity-access/src/app/app.module.ts` to import `AuthModule` and apply `TenantContextMiddleware` to all routes:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TenantContextModule, AuthModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=auth.controller
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Run the full test suite for this app**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access
```

Expected: 0 typecheck errors, all tests passing (tenant-connection: 3, seed-rbac-catalog: 3, accounts.service: 3, auth.service: 4, auth.controller: 2 — 15 total).

- [ ] **Step 9: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/auth new/code/apps/identity-access/src/accounts/accounts.module.ts new/code/apps/identity-access/src/app/app.module.ts new/code/package.json new/code/pnpm-lock.yaml
git commit -m "feat: add AuthController POST /auth/login endpoint, wire AppModule with tenant context middleware"
```

---

### Task 9: End-to-End Cross-Tenant Isolation Test via the Real HTTP Endpoint

**Files:**
- Test: `new/code/apps/identity-access/src/auth/cross-tenant-login.integration-spec.ts`

**Interfaces:**
- Consumes: the full running `AppModule` (Task 8) over HTTP via `supertest`.

This is the top-level proof the design spec's Testing section requires: a JWT/login attempt scoped to one tenant must never succeed against, or leak data from, another tenant — verified here through the real HTTP surface, on top of Task 3's lower-level proof at the connection layer.

- [ ] **Step 1: Write the test**

Create `new/code/apps/identity-access/src/auth/cross-tenant-login.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthModule } from './auth.module.js';

describe('Cross-tenant login isolation (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    const accountsService = new AccountsService(tenantConnection, dataSource);

    for (const tenantId of ['test_xtenant_a', 'test_xtenant_b']) {
      await accountsService.provisionTenantSchema(dataSource, tenantId);
    }

    await tenantContext.run({ tenantId: 'test_xtenant_a', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'a@example.com',
        displayName: 'Tenant A User',
        password: 'tenant-a-password',
        roleName: 'Doctor',
      }),
    );
    await tenantContext.run({ tenantId: 'test_xtenant_b', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'b@example.com',
        displayName: 'Tenant B User',
        password: 'tenant-b-password',
        roleName: 'Nurse',
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(TenantContextService)
      .useValue(tenantContext)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_xtenant_a" CASCADE`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_xtenant_b" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('the same username in two tenants authenticates independently with different passwords', async () => {
    const resA = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_a')
      .send({ username: 'shared.username', password: 'tenant-a-password' });
    expect(resA.status).toBe(200);

    const resB = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_b')
      .send({ username: 'shared.username', password: 'tenant-b-password' });
    expect(resB.status).toBe(200);
  });

  it("tenant A's password never authenticates against tenant B's account of the same username", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_b')
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    expect(response.status).toBe(401);
  });

  it("a JWT's hospitalId claim reflects only the tenant it was issued under", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_a')
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    const payload = JSON.parse(
      Buffer.from(response.body.accessToken.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.hospitalId).toBe('test_xtenant_a');
    expect(payload.roles).toEqual(['Doctor']);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPattern=cross-tenant-login
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the complete test suite one final time**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access
```

Expected: 0 typecheck errors, 18 tests passing total (15 from Task 8 + 3 new).

- [ ] **Step 4: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/auth/cross-tenant-login.integration-spec.ts
git commit -m "test: add end-to-end cross-tenant login isolation test over the real HTTP endpoint"
```

---

## Self-Review Notes

- **Spec coverage:** platform-level RBAC catalog (14 roles, PRD §6.1) ✓ Task 4; per-tenant accounts/account_roles ✓ Task 5; staff bcrypt login ✓ Task 6/7; JWT issuance with `sub`/`roles`/`hospitalId` claims ✓ Task 7; 5-attempt/15-minute lockout ✓ Task 7; cross-tenant leakage test (design spec's explicit Testing requirement) ✓ Tasks 3 and 9, at two layers. Explicitly deferred items (OTP, admin unlock, forced password change, `rbac.changed`, reactive tenant provisioning) are listed in the plan header, not silently dropped.
- **Placeholder scan:** the `permissions: []` in `AuthService.login` is flagged inline as an intentional, documented gap (no permissions are seeded against roles yet), not a silent TODO.
- **Type consistency:** `LoginResult`'s three shapes (Task 7) are consumed with matching `'accessToken' in result` / `'locked' in result` discriminant checks in `AuthController` (Task 8) — no mismatched field names between the two tasks. `AccountWithRoles` (Task 6) matches the destructuring (`{ account, roleNames }`) used in Task 7.
