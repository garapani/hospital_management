# System Admin Tenant Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tenant registry (System Admin's first slice) as a new domain module inside `apps/api`: ops can provision, list, view, suspend, and reactivate hospital tenants over a permission-gated REST API. Registry only — no `module_toggles`/`hospital_settings`, no messaging (per the modular-monolith design, `docs/superpowers/specs/2026-07-31-modular-monolith-architecture-design.md` and PRD §5.1/§8).

**Architecture:** New `apps/api/src/tenants/` domain folder, following the exact pattern already established by `apps/api/src/accounts/`. The `tenants` table is platform-level (not tenant-scoped) and lives in the `public` schema of the one shared Postgres instance, alongside the RBAC catalog (`roles`/`permissions`/`role_permissions`) — same treatment as those tables, no `TenantConnectionService`/tenant-schema switching involved. A new shared `DatabaseModule` is extracted first so `TenantsModule` doesn't need to either duplicate a second `DataSource`/connection pool or awkwardly depend on `AccountsModule` just for infrastructure.

**Tech Stack:** NestJS/TypeScript, TypeORM (hand-managed `DataSource`, no `@nestjs/typeorm`), Jest — unchanged from the rest of `apps/api`.

## Global Constraints

- Every relative import needs an explicit `.js` extension (this workspace's `tsconfig.base.json` uses `"module"`/`"moduleResolution": "nodenext"`) — verify with `pnpm exec nx run-many -t test typecheck` (not just `test`), run from `new/code`.
- Use `--testPathPatterns` (plural) if running Jest directly on a subset of files — `--testPathPattern` (singular) errors on this Jest version.
- Mutating service methods use the load-then-`save()` pattern, never `.update()`/`.increment()`/`.decrement()` — this project's convention (see `apps/api/src/accounts/accounts.service.ts` for the established pattern), and it matters here because `@hospital/audit-emitter`'s `AuditSubscriber` only fires on `Repository.save()`/`.remove()`.
- `hospitalId` values must be validated against `/^[a-z0-9_]+$/` before use — this is the same format `AccountsService.provisionTenantSchema` already enforces for `tenant_<hospitalId>` schema names (`apps/api/src/accounts/accounts.service.ts`), and this registry's `hospitalId` is the same identifier space.
- No `ValidationPipe`/class-validator on DTOs — matches this codebase's existing convention (see `CreateAccountDto`); not introducing new dependencies for this plan.
- `apps/api/src/database/migrate.ts` is known-broken (pre-existing, unrelated to this plan — a TypeORM/tsx decorator-metadata error). New migrations must be applied to the dev database manually via `psql`, matching the precedent already established for this app's other migrations.
- The `tenants` table is a shared, persistent platform table (not a disposable per-test `tenant_<id>` schema like `accounts`, and not an idempotent fixed catalog like `roles`/`permissions`). Every test file that creates rows in it must delete them in `afterAll` (e.g. `DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`), or a second run against the same dev database fails with `ConflictException: Tenant ... already exists` on rows left over from the previous run.
- Follow this workspace's git conventions: never `git commit --amend`, never add AI co-authorship trailers, prefer `git add <specific files>` over `git add -A` (a prior task in this repo's history accidentally committed unrelated untracked files, including a broken git submodule reference, via `git add -A` — name files explicitly in every commit in this plan).

---

### Task 1: Extract a shared `DatabaseModule`; refactor `AccountsModule` to use it

**Files:**
- Create: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/accounts/accounts.module.ts`

**Interfaces:**
- Produces: `DatabaseModule`, a `@Global()` NestJS module exporting a singleton `DataSource` provider (same factory logic `AccountsModule` already used) — every future domain module (including `TenantsModule` in Task 5) imports this instead of each declaring its own `DataSource` provider, avoiding duplicate connection pools to the one shared Postgres instance the modular-monolith design commits to.

This is a pure refactor — no behavior change. There is no new test to write; verification is that the full existing suite still passes unchanged.

- [ ] **Step 1: Create `DatabaseModule`**

Create `apps/api/src/database/database.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';

@Global()
@Module({
  providers: [
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
  exports: [DataSource],
})
export class DatabaseModule {}
```

- [ ] **Step 2: Refactor `AccountsModule` to import `DatabaseModule` instead of declaring its own `DataSource` provider**

In `apps/api/src/accounts/accounts.module.ts`, replace the whole file with:

```typescript
import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { LoggingAuditEventPublisher } from './logging-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    TenantConnectionService,
    { provide: AUDIT_EVENT_PUBLISHER, useClass: LoggingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [DatabaseModule, AccountsService, TenantConnectionService],
})
export class AccountsModule {}
```

Note exactly two things changed from the prior version: the inline `{ provide: DataSource, useFactory: ... }` provider is gone (now supplied by the imported, `@Global()` `DatabaseModule`), and `exports` lists `DatabaseModule` instead of the bare `DataSource` token — re-exporting an externally-provided token requires re-exporting the module that provides it, per NestJS's module resolution rules, so this is required for anything that previously did `moduleRef.get(DataSource)` off of `AccountsModule` (e.g. its own integration tests) to keep working. The `import { DataSource } from 'typeorm';` line is no longer needed in this file — remove it along with `import { createDataSource } from '../database/data-source.js';`.

- [ ] **Step 3: Verify nothing broke**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: same as before this task — 11 test suites passed, 46 tests passed, 0 typecheck errors. This task adds no new tests because it changes no behavior; if any existing test fails, the refactor broke something and must be fixed before proceeding.

- [ ] **Step 4: Commit**

```bash
git add new/code/apps/api/src/database/database.module.ts new/code/apps/api/src/accounts/accounts.module.ts
git commit -m "refactor: extract shared DatabaseModule so every domain module reuses one DataSource"
```

---

### Task 2: Seed the `system-admin.tenants.manage` permission (Super Admin only)

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `system-admin.tenants.manage` permission row, mapped to `Super Admin` only (not `Hospital Admin` — provisioning/suspending hospitals is a platform-ops action, not something a single hospital's admin should be able to do to *other* hospitals). `TenantsController` (Task 5) requires this exact permission name.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the end of the `describe('seedRbacCatalog (integration)', ...)` block in `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts` (after the existing `'maps identity.accounts.manage to Hospital Admin and Super Admin only'` test, still inside the same `describe`):

```typescript
  it('creates the system-admin.tenants.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps system-admin.tenants.manage to Super Admin only, not Hospital Admin', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name)).toEqual(['Super Admin']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog.integration-spec`

Expected: FAIL — `system-admin.tenants.manage` permission not found (the two new tests fail; the pre-existing tests in this file still pass).

- [ ] **Step 3: Add the permission and role mapping**

In `apps/api/src/rbac/seed-rbac-catalog.ts`, add a new entry to `PERMISSION_CATALOG`:

```typescript
const PERMISSION_CATALOG: PermissionSeed[] = [
  {
    name: 'identity.accounts.manage',
    description: 'Create, list, deactivate, unlock accounts and manage role assignments.',
  },
  {
    name: 'system-admin.tenants.manage',
    description: 'Provision, list, view, suspend, and reactivate hospital tenants.',
  },
];
```

And a new entry to `ROLE_PERMISSION_MAPPINGS` (Super Admin only — do not add a Hospital Admin mapping):

```typescript
const ROLE_PERMISSION_MAPPINGS: RolePermissionMapping[] = [
  { roleName: 'Hospital Admin', permissionName: 'identity.accounts.manage' },
  { roleName: 'Super Admin', permissionName: 'identity.accounts.manage' },
  { roleName: 'Super Admin', permissionName: 'system-admin.tenants.manage' },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog.integration-spec`

Expected: PASS — all tests in this file, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/rbac/seed-rbac-catalog.ts new/code/apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: seed system-admin.tenants.manage permission for Super Admin only"
```

---

### Task 3: `Tenant` entity and migration

**Files:**
- Create: `apps/api/src/tenants/entities/tenant.entity.ts`
- Create: `apps/api/src/database/migrations/1738200000004-create-tenants-table.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: `Tenant` entity (`hospitalId` primary key, `hospitalName`, `status`, `createdAt`, `activatedAt`, `suspendedAt`, `createdBy`) — consumed by `TenantsService` in Task 4.

There is no test for this task in isolation (an entity/migration with no service atop it has nothing meaningful to assert); Task 4's tests are the first thing that exercises this table, and are where TDD applies.

- [ ] **Step 1: Create the entity**

Create `apps/api/src/tenants/entities/tenant.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar' })
  hospitalId!: string;

  @Column()
  hospitalName!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: 'active' | 'suspended';

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  activatedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;
}
```

- [ ] **Step 2: Create the migration**

Create `apps/api/src/database/migrations/1738200000004-create-tenants-table.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantsTable1738200000004 implements MigrationInterface {
  name = 'CreateTenantsTable1738200000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenants (
        "hospitalId" varchar PRIMARY KEY,
        "hospitalName" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'active',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "activatedAt" timestamptz,
        "suspendedAt" timestamptz,
        "createdBy" varchar
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenants`);
  }
}
```

- [ ] **Step 3: Register the entity and migration in `data-source.ts`**

In `apps/api/src/database/data-source.ts`, add the new imports:

```typescript
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { CreateTenantsTable1738200000004 } from './migrations/1738200000004-create-tenants-table.js';
```

And add `Tenant` to the `entities` array and `CreateTenantsTable1738200000004` to the `migrations` array:

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant],
    migrations: [
      CreateRbacCatalogTables1738200000000,
      AddRolePermissionsUniqueConstraint1738200000002,
      CreateTenantsTable1738200000004,
    ],
```

- [ ] **Step 4: Apply the migration to the dev database manually**

`apps/api/src/database/migrate.ts` is known-broken (Global Constraints) — apply this migration directly via `psql`, matching this app's established precedent:

```bash
docker compose -f docker-compose.dev.yml exec -T api-postgres psql -U identity_access -d identity_access <<'SQL'
CREATE TABLE tenants (
  "hospitalId" varchar PRIMARY KEY,
  "hospitalName" varchar NOT NULL,
  status varchar NOT NULL DEFAULT 'active',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "activatedAt" timestamptz,
  "suspendedAt" timestamptz,
  "createdBy" varchar
);
INSERT INTO migrations (timestamp, name) VALUES (1738200000004, 'CreateTenantsTable1738200000004');
\dt
SQL
```

Expected: `CREATE TABLE`, `INSERT 0 1`, and the `\dt` listing shows `tenants` alongside `migrations`, `permissions`, `role_permissions`, `roles`, `accounts`-related tables (if any tenant schemas exist from prior test runs — those are separate `tenant_*` schemas and won't show in the default `public`-schema `\dt` listing).

- [ ] **Step 5: Verify typecheck still passes with the new entity registered**

Run from `new/code`:

```bash
pnpm exec nx run-many -t typecheck --skip-nx-cache --projects=api
```

Expected: 0 typecheck errors.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/tenants/entities/tenant.entity.ts new/code/apps/api/src/database/migrations/1738200000004-create-tenants-table.ts new/code/apps/api/src/database/data-source.ts
git commit -m "feat: add Tenant entity and tenants table migration"
```

---

### Task 4: `TenantsService`

**Files:**
- Create: `apps/api/src/tenants/tenants.service.ts`
- Test: `apps/api/src/tenants/tenants.service.integration-spec.ts`

**Interfaces:**
- Consumes: `Tenant` entity (Task 3), `DataSource` (from `DatabaseModule`, Task 1).
- Produces: `TenantsService` with `provisionTenant(input: ProvisionTenantInput): Promise<Tenant>`, `listTenants(): Promise<Tenant[]>`, `getTenant(hospitalId: string): Promise<Tenant | null>`, `suspendTenant(hospitalId: string): Promise<Tenant>`, `reactivateTenant(hospitalId: string): Promise<Tenant>` — consumed by `TenantsController` in Task 5.

Suspend/reactivate on a tenant already in that state is an idempotent no-op (returns the tenant unchanged, does not throw) — ops retries (e.g. a double-click) shouldn't be punished. `reactivateTenant` sets a fresh `activatedAt` timestamp on each reactivation and leaves `suspendedAt` as the historical record of the last suspension (not nulled out).

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/tenants/tenants.service.integration-spec.ts`:

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { createDataSource } from '../database/data-source.js';
import { TenantsService } from './tenants.service.js';

describe('TenantsService (integration)', () => {
  const dataSource = createDataSource();
  const tenantsService = new TenantsService(dataSource);

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('provisions a tenant as active with an activatedAt timestamp', async () => {
    const tenant = await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_provision',
      hospitalName: 'Test Hospital Provision',
      createdBy: 'ops.alice',
    });

    expect(tenant.hospitalId).toBe('test_tenant_svc_provision');
    expect(tenant.status).toBe('active');
    expect(tenant.activatedAt).not.toBeNull();
    expect(tenant.createdBy).toBe('ops.alice');
  });

  it('rejects provisioning a hospitalId that already exists with a 409', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_dup',
      hospitalName: 'Dup Hospital',
    });

    await expect(
      tenantsService.provisionTenant({ hospitalId: 'test_tenant_svc_dup', hospitalName: 'Dup Hospital Again' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an unsafe hospitalId format', async () => {
    await expect(
      tenantsService.provisionTenant({ hospitalId: 'Not Safe!', hospitalName: 'Bad Id Hospital' }),
    ).rejects.toThrow();
  });

  it('lists provisioned tenants', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_list',
      hospitalName: 'List Hospital',
    });

    const tenants = await tenantsService.listTenants();
    expect(tenants.some((t) => t.hospitalId === 'test_tenant_svc_list')).toBe(true);
  });

  it('gets a single tenant by hospitalId, or null if unknown', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_get',
      hospitalName: 'Get Hospital',
    });

    const found = await tenantsService.getTenant('test_tenant_svc_get');
    expect(found?.hospitalName).toBe('Get Hospital');

    const missing = await tenantsService.getTenant('test_tenant_svc_nonexistent');
    expect(missing).toBeNull();
  });

  it('suspends an active tenant, recording suspendedAt', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_suspend',
      hospitalName: 'Suspend Hospital',
    });

    const suspended = await tenantsService.suspendTenant('test_tenant_svc_suspend');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedAt).not.toBeNull();
  });

  it('suspending an already-suspended tenant is an idempotent no-op', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_suspend_twice',
      hospitalName: 'Suspend Twice Hospital',
    });
    await tenantsService.suspendTenant('test_tenant_svc_suspend_twice');

    const secondSuspend = await tenantsService.suspendTenant('test_tenant_svc_suspend_twice');
    expect(secondSuspend.status).toBe('suspended');
  });

  it('reactivates a suspended tenant, recording a fresh activatedAt', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_reactivate',
      hospitalName: 'Reactivate Hospital',
    });
    await tenantsService.suspendTenant('test_tenant_svc_reactivate');

    const reactivated = await tenantsService.reactivateTenant('test_tenant_svc_reactivate');
    expect(reactivated.status).toBe('active');
    expect(reactivated.activatedAt).not.toBeNull();
  });

  it('suspend/reactivate on an unknown hospitalId throws NotFoundException', async () => {
    await expect(tenantsService.suspendTenant('test_tenant_svc_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
    await expect(tenantsService.reactivateTenant('test_tenant_svc_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=tenants.service.integration-spec`

Expected: FAIL with `Cannot find module './tenants.service.js'` (the service doesn't exist yet).

- [ ] **Step 3: Implement `TenantsService`**

Create `apps/api/src/tenants/tenants.service.ts`:

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity.js';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

export interface ProvisionTenantInput {
  hospitalId: string;
  hospitalName: string;
  createdBy?: string;
}

@Injectable()
export class TenantsService {
  constructor(private readonly dataSource: DataSource) {}

  async provisionTenant(input: ProvisionTenantInput): Promise<Tenant> {
    if (!SAFE_HOSPITAL_ID.test(input.hospitalId)) {
      throw new BadRequestException(`Invalid hospitalId format: ${input.hospitalId}`);
    }

    const repository = this.dataSource.getRepository(Tenant);
    const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
    if (existing) {
      throw new ConflictException(`Tenant ${input.hospitalId} already exists`);
    }

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=tenants.service.integration-spec`

Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/tenants/tenants.service.ts new/code/apps/api/src/tenants/tenants.service.integration-spec.ts
git commit -m "feat: add TenantsService (provision, list, get, suspend, reactivate)"
```

---

### Task 5: `TenantsController`, `TenantsModule`, and wiring into `AppModule`

**Files:**
- Create: `apps/api/src/tenants/dto/provision-tenant.dto.ts`
- Create: `apps/api/src/tenants/tenants.controller.ts`
- Test: `apps/api/src/tenants/tenants.controller.integration-spec.ts`
- Create: `apps/api/src/tenants/tenants.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `TenantsService` (Task 4), `PermissionGuard`/`RequirePermission` from `@hospital/auth-guards`, `DatabaseModule` (Task 1), the `system-admin.tenants.manage` permission (Task 2).
- Produces: `POST /tenants`, `GET /tenants`, `GET /tenants/:hospitalId`, `PATCH /tenants/:hospitalId/suspend`, `PATCH /tenants/:hospitalId/reactivate` — all gated by `system-admin.tenants.manage`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/tenants/dto/provision-tenant.dto.ts` first (needed by the test file, not itself under test):

```typescript
export class ProvisionTenantDto {
  hospitalId!: string;
  hospitalName!: string;
  createdBy?: string;
}
```

Create `apps/api/src/tenants/tenants.controller.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { TenantsModule } from './tenants.module.js';

describe('TenantsController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const adminHeaders = { 'x-permissions': 'system-admin.tenants.manage' };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [TenantsModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`);
    await dataSource.destroy();
    await app.close();
  });

  it('provisions a tenant and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_create', hospitalName: 'Ctrl Create Hospital' });

    expect(response.status).toBe(201);
    expect(response.body.hospitalId).toBe('test_tenant_ctrl_create');
    expect(response.body.status).toBe('active');
  });

  it('rejects provisioning a duplicate hospitalId with 409', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital' });

    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital Again' });

    expect(response.status).toBe(409);
  });

  it('lists tenants', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_list', hospitalName: 'List Hospital' });

    const response = await request(app.getHttpServer()).get('/tenants').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(
      response.body.some((t: { hospitalId: string }) => t.hospitalId === 'test_tenant_ctrl_list'),
    ).toBe(true);
  });

  it('gets a single tenant, 404 for an unknown one', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_get', hospitalName: 'Get Hospital' });

    const found = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_get')
      .set(adminHeaders);
    expect(found.status).toBe(200);
    expect(found.body.hospitalName).toBe('Get Hospital');

    const missing = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_nonexistent')
      .set(adminHeaders);
    expect(missing.status).toBe(404);
  });

  it('suspends and reactivates a tenant', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_lifecycle', hospitalName: 'Lifecycle Hospital' });

    const suspended = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/suspend')
      .set(adminHeaders);
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const reactivated = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/reactivate')
      .set(adminHeaders);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('active');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=tenants.controller.integration-spec`

Expected: FAIL with `Cannot find module './tenants.module.js'` (nothing built yet).

- [ ] **Step 3: Implement `TenantsController`**

Create `apps/api/src/tenants/tenants.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { TenantsService } from './tenants.service.js';
import { ProvisionTenantDto } from './dto/provision-tenant.dto.js';

const REQUIRED_PERMISSION = 'system-admin.tenants.manage';

@Controller('tenants')
@UseGuards(PermissionGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async provision(@Body() body: ProvisionTenantDto) {
    return this.tenantsService.provisionTenant(body);
  }

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async list() {
    return this.tenantsService.listTenants();
  }

  @Get(':hospitalId')
  @RequirePermission(REQUIRED_PERMISSION)
  async getOne(@Param('hospitalId') hospitalId: string) {
    const tenant = await this.tenantsService.getTenant(hospitalId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    return tenant;
  }

  @Patch(':hospitalId/suspend')
  @RequirePermission(REQUIRED_PERMISSION)
  async suspend(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.suspendTenant(hospitalId);
  }

  @Patch(':hospitalId/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivate(@Param('hospitalId') hospitalId: string) {
    return this.tenantsService.reactivateTenant(hospitalId);
  }
}
```

- [ ] **Step 4: Create `TenantsModule`**

Create `apps/api/src/tenants/tenants.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { TenantsController } from './tenants.controller.js';
import { TenantsService } from './tenants.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
```

- [ ] **Step 5: Wire `TenantsModule` into `AppModule`**

Replace `apps/api/src/app/app.module.ts` with:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=tenants.controller.integration-spec`

Expected: PASS — all 5 tests.

- [ ] **Step 7: Run the full suite**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: all test suites pass (11 from before this plan + Task 4's `tenants.service.integration-spec.ts` + this task's `tenants.controller.integration-spec.ts` = 13), 0 typecheck errors.

- [ ] **Step 8: Commit**

```bash
git add new/code/apps/api/src/tenants/dto/provision-tenant.dto.ts new/code/apps/api/src/tenants/tenants.controller.ts new/code/apps/api/src/tenants/tenants.controller.integration-spec.ts new/code/apps/api/src/tenants/tenants.module.ts new/code/apps/api/src/app/app.module.ts
git commit -m "feat: add TenantsController and wire TenantsModule into AppModule"
```

---

### Task 6: Cross-cutting permission-gating test

**Files:**
- Test: `apps/api/src/tenants/tenants-permission-gating.integration-spec.ts`

**Interfaces:** Consumes `TenantsModule` (Task 5). No implementation changes — this task only adds test coverage, mirroring the equivalent test already written for `AccountsController` (`apps/api/src/accounts/accounts-permission-gating.integration-spec.ts`).

- [ ] **Step 1: Write the test**

Create `apps/api/src/tenants/tenants-permission-gating.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { TenantsModule } from './tenants.module.js';
import { TenantsService } from './tenants.service.js';

describe('TenantsController permission gating (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const noPermissionHeaders = {};

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [TenantsModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const tenantsService = moduleRef.get(TenantsService);
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_permgate',
      hospitalName: 'Permission Gate Hospital',
    });

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = 'test_tenant_permgate'`);
    await dataSource.destroy();
    await app.close();
  });

  it('rejects provisioning with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set(noPermissionHeaders)
      .send({ hospitalId: 'blocked_tenant', hospitalName: 'Blocked Hospital' });
    expect(response.status).toBe(403);
  });

  it('rejects listing tenants with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/tenants').set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single tenant with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get('/tenants/test_tenant_permgate')
      .set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects suspend/reactivate with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const suspendResponse = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_permgate/suspend')
      .set(noPermissionHeaders);
    expect(suspendResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_permgate/reactivate')
      .set(noPermissionHeaders);
    expect(reactivateResponse.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec nx test api --testPathPatterns=tenants-permission-gating.integration-spec`

Expected: PASS — all 4 tests, first try (this mirrors an already-proven pattern from `AccountsController`'s equivalent test; `PermissionGuard` behavior itself is not new).

- [ ] **Step 3: Run the full suite one last time**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: all test suites pass (14 total), 0 typecheck errors.

- [ ] **Step 4: Commit**

```bash
git add new/code/apps/api/src/tenants/tenants-permission-gating.integration-spec.ts
git commit -m "test: add cross-cutting 403 coverage for every tenants route without system-admin.tenants.manage"
```
