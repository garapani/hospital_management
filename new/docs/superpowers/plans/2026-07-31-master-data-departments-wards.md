# Master Data — Departments and Wards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `departments` and `wards` as a new domain module inside `apps/api` — ops/hospital-admin staff can create, list, view, deactivate, and reactivate departments and wards over a permission-gated REST API. Per `docs/superpowers/specs/2026-07-31-master-data-departments-wards-design.md`. First slice of Master Data — the generic `lookups` registry and all platform-level bulk reference data (states, districts, ICD10 codes, payment modes) are explicitly out of scope, deferred until a real consumer needs them.

**Architecture:** New `apps/api/src/master-data/` domain folder, following the exact pattern established by `apps/api/src/accounts/` and `apps/api/src/tenants/`. Both `departments` and `wards` are per-tenant tables (inside `tenant_<hospitalId>`, like `accounts`) — their migration is added to `AccountsService.provisionTenantSchema`'s per-tenant migration list, not `data-source.ts`'s platform-level list. Reads/writes go through `TenantConnectionService` (from the shared `DatabaseModule`), no caching layer — in-process calls are already fast, and caching is deferred until proven necessary.

**Tech Stack:** NestJS/TypeScript, TypeORM, Jest — unchanged from the rest of `apps/api`.

## Global Constraints

- Every relative import needs an explicit `.js` extension.
- Use `--testPathPatterns` (plural) if running Jest directly on a subset of files.
- Mutating service methods use load-then-`save()`, never `.update()`/`.increment()`/`.decrement()`.
- No `ValidationPipe`/class-validator on DTOs — matches this codebase's existing convention.
- `apps/api/src/database/migrate.ts` is known-broken (pre-existing, unrelated to this plan). This plan's migration is tenant-scoped (applied dynamically via `provisionTenantSchema`, like the `tenants` and `audit_records` migrations before it) — no manual `psql` step is needed, unlike a platform-level migration.
- Follow this workspace's git conventions: never `git commit --amend`, never add AI co-authorship trailers, and `git add` only the exact files named in each task — never `git add -A` or `git add .`.
- Each test file provisions its own distinct tenant schema (one `hospitalId` per file, dropped via `DROP SCHEMA ... CASCADE` in `afterAll`) so parallel Jest workers never collide: `test_masterdata_svc` for the service test, `test_masterdata_ctrl` for the controller test, `test_masterdata_permgate` for the permission-gating test. This matches `accounts`' established per-test-file disposable-schema pattern (departments/wards are tenant-scoped, unlike the platform-level `tenants` table from an earlier plan, which needed a different, shared-table cleanup approach instead).

---

### Task 1: Seed the `master-data.manage` permission (Hospital Admin and Super Admin)

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`

**Interfaces:**
- Produces: a `master-data.manage` permission row, mapped to both `Hospital Admin` and `Super Admin` — consumed by `MasterDataController` in Task 4.

- [ ] **Step 1: Write the failing tests**

Add these two tests to the end of the `describe('seedRbacCatalog (integration)', ...)` block in `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts` (after the existing `system-admin.tenants.manage` tests, still inside the same `describe`):

```typescript
  it('creates the master-data.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps master-data.manage to Hospital Admin and Super Admin', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog.integration-spec`

Expected: FAIL — `master-data.manage` permission not found (the two new tests fail; every pre-existing test in this file still passes).

- [ ] **Step 3: Add the permission and role mappings**

In `apps/api/src/rbac/seed-rbac-catalog.ts`, add a new entry to `PERMISSION_CATALOG`:

```typescript
  {
    name: 'master-data.manage',
    description: 'Create, list, deactivate, and reactivate departments and wards.',
  },
```

And two new entries to `ROLE_PERMISSION_MAPPINGS` (both Hospital Admin and Super Admin — unlike `system-admin.tenants.manage`, which is Super Admin only):

```typescript
  { roleName: 'Hospital Admin', permissionName: 'master-data.manage' },
  { roleName: 'Super Admin', permissionName: 'master-data.manage' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog.integration-spec`

Expected: PASS — every test in this file, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/rbac/seed-rbac-catalog.ts new/code/apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: seed master-data.manage permission for Hospital Admin and Super Admin"
```

---

### Task 2: `Department`/`Ward` entities and per-tenant migration

**Files:**
- Create: `apps/api/src/master-data/entities/department.entity.ts`
- Create: `apps/api/src/master-data/entities/ward.entity.ts`
- Create: `apps/api/src/database/migrations/1738200000006-create-master-data-tables.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: `Department`, `Ward` entities — consumed by `MasterDataService` in Task 3.

No test for this task in isolation — same reasoning as every prior entity/migration task in this project: nothing meaningful to assert about an entity with no service atop it yet.

- [ ] **Step 1: Create the entities**

Create `apps/api/src/master-data/entities/department.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  departmentCode!: string;

  @Column()
  departmentName!: string;

  @Column({ type: 'varchar', nullable: true })
  description!: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  isAppointmentApplicable!: boolean;

  @Column({ type: 'uuid', nullable: true })
  parentDepartmentId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  roomNumber!: string | null;

  @Column({ type: 'varchar', nullable: true })
  noticeText!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
```

Create `apps/api/src/master-data/entities/ward.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('wards')
export class Ward {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  wardCode!: string;

  @Column()
  wardName!: string;

  @Column({ type: 'varchar', nullable: true })
  wardType!: string | null;

  @Column({ type: 'int', nullable: true })
  bedCapacity!: number | null;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
```

- [ ] **Step 2: Create the migration**

Create `apps/api/src/database/migrations/1738200000006-create-master-data-tables.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMasterDataTables1738200000006 implements MigrationInterface {
  name = 'CreateMasterDataTables1738200000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentCode" varchar NOT NULL UNIQUE,
        "departmentName" varchar NOT NULL,
        description varchar NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "isAppointmentApplicable" boolean NOT NULL DEFAULT false,
        "parentDepartmentId" uuid NULL REFERENCES departments(id),
        "roomNumber" varchar NULL,
        "noticeText" varchar NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE wards (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "wardCode" varchar NOT NULL UNIQUE,
        "wardName" varchar NOT NULL,
        "wardType" varchar NULL,
        "bedCapacity" integer NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE wards`);
    await queryRunner.query(`DROP TABLE departments`);
  }
}
```

- [ ] **Step 3: Register the entities in `data-source.ts`**

In `apps/api/src/database/data-source.ts`, add the imports:

```typescript
import { Department } from '../master-data/entities/department.entity.js';
import { Ward } from '../master-data/entities/ward.entity.js';
```

And add both to the `entities` array (do **not** add the migration to the `migrations` array — this is tenant-scoped, provisioned per-tenant in Step 4 below):

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward],
```

- [ ] **Step 4: Provision the migration in `AccountsService.provisionTenantSchema`**

In `apps/api/src/accounts/accounts.service.ts`, add the import:

```typescript
import { CreateMasterDataTables1738200000006 } from '../database/migrations/1738200000006-create-master-data-tables.js';
```

And add a fourth migration step inside `provisionTenantSchema`, after the existing three:

```typescript
      const auditRecordsMigration = new CreateAuditRecordsTable1738200000005();
      await auditRecordsMigration.up(queryRunner);
      const masterDataMigration = new CreateMasterDataTables1738200000006();
      await masterDataMigration.up(queryRunner);
```

- [ ] **Step 5: Verify typecheck still passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t typecheck --skip-nx-cache --projects=api
```

Expected: 0 typecheck errors.

- [ ] **Step 6: Verify the full suite still passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test --skip-nx-cache --projects=api
```

Expected: same suite/test counts as before this task — every test that calls `provisionTenantSchema` now also creates `departments`/`wards` tables as a side effect, but nothing yet asserts on them.

- [ ] **Step 7: Commit**

```bash
git add new/code/apps/api/src/master-data/entities/department.entity.ts new/code/apps/api/src/master-data/entities/ward.entity.ts new/code/apps/api/src/database/migrations/1738200000006-create-master-data-tables.ts new/code/apps/api/src/database/data-source.ts new/code/apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add Department and Ward entities and per-tenant migration"
```

---

### Task 3: `MasterDataService`

**Files:**
- Create: `apps/api/src/master-data/master-data.service.ts`
- Test: `apps/api/src/master-data/master-data.service.integration-spec.ts`

**Interfaces:**
- Consumes: `Department`/`Ward` entities (Task 2), `TenantConnectionService` (from `DatabaseModule`).
- Produces: `MasterDataService` with `createDepartment`, `listDepartments`, `getDepartment`, `deactivateDepartment`, `reactivateDepartment`, `createWard`, `listWards`, `getWard`, `deactivateWard`, `reactivateWard` — consumed by `MasterDataController` in Task 4.

Deactivating an already-inactive department/ward, or reactivating an already-active one, is an idempotent no-op (returns it unchanged), matching the pattern established in the tenant registry plan. Deactivating a department that is still the `parentDepartmentId` of an active child department is rejected with a 409 — this is the one rule that has no equivalent in prior plans.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/master-data/master-data.service.integration-spec.ts`:

```typescript
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { MasterDataService } from './master-data.service.js';

describe('MasterDataService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const masterDataService = new MasterDataService(tenantConnection);

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_svc');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_svc" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_masterdata_svc', correlationId: 'test' }, work);
  }

  describe('departments', () => {
    it('creates a department as active', async () => {
      const department = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'CARD', departmentName: 'Cardiology' }),
      );
      expect(department.departmentCode).toBe('CARD');
      expect(department.isActive).toBe(true);
    });

    it('rejects a duplicate departmentCode with 409', async () => {
      await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'ORTH', departmentName: 'Orthopedics' }),
      );
      await expect(
        inTenant(() =>
          masterDataService.createDepartment({ departmentCode: 'ORTH', departmentName: 'Orthopedics Again' }),
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('lists and gets departments, returns null for an unknown id', async () => {
      const created = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'NEUR', departmentName: 'Neurology' }),
      );

      const list = await inTenant(() => masterDataService.listDepartments());
      expect(list.some((d) => d.departmentCode === 'NEUR')).toBe(true);

      const found = await inTenant(() => masterDataService.getDepartment(created.id));
      expect(found?.departmentName).toBe('Neurology');

      const missing = await inTenant(() =>
        masterDataService.getDepartment('00000000-0000-0000-0000-000000000000'),
      );
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a department', async () => {
      const created = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'ENT', departmentName: 'ENT' }),
      );

      const deactivated = await inTenant(() => masterDataService.deactivateDepartment(created.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateDepartment(created.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('rejects deactivating a department that is the parent of an active child, with 409', async () => {
      const parent = await inTenant(() =>
        masterDataService.createDepartment({ departmentCode: 'SURG', departmentName: 'Surgery' }),
      );
      await inTenant(() =>
        masterDataService.createDepartment({
          departmentCode: 'SURG-ORTHO',
          departmentName: 'Orthopedic Surgery',
          parentDepartmentId: parent.id,
        }),
      );

      await expect(inTenant(() => masterDataService.deactivateDepartment(parent.id))).rejects.toThrow(
        ConflictException,
      );
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateDepartment('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        inTenant(() => masterDataService.reactivateDepartment('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('wards', () => {
    it('creates a ward as active', async () => {
      const ward = await inTenant(() =>
        masterDataService.createWard({ wardCode: 'W1', wardName: 'General Ward 1', bedCapacity: 20 }),
      );
      expect(ward.wardCode).toBe('W1');
      expect(ward.isActive).toBe(true);
      expect(ward.bedCapacity).toBe(20);
    });

    it('rejects a duplicate wardCode with 409', async () => {
      await inTenant(() => masterDataService.createWard({ wardCode: 'W2', wardName: 'ICU' }));
      await expect(
        inTenant(() => masterDataService.createWard({ wardCode: 'W2', wardName: 'ICU Again' })),
      ).rejects.toThrow(ConflictException);
    });

    it('lists and gets wards, returns null for an unknown id', async () => {
      const created = await inTenant(() => masterDataService.createWard({ wardCode: 'W3', wardName: 'Maternity' }));

      const list = await inTenant(() => masterDataService.listWards());
      expect(list.some((w) => w.wardCode === 'W3')).toBe(true);

      const found = await inTenant(() => masterDataService.getWard(created.id));
      expect(found?.wardName).toBe('Maternity');

      const missing = await inTenant(() => masterDataService.getWard('00000000-0000-0000-0000-000000000000'));
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a ward', async () => {
      const created = await inTenant(() => masterDataService.createWard({ wardCode: 'W4', wardName: 'Pediatrics' }));

      const deactivated = await inTenant(() => masterDataService.deactivateWard(created.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateWard(created.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateWard('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=master-data.service.integration-spec`

Expected: FAIL with `Cannot find module './master-data.service.js'` (the service doesn't exist yet).

- [ ] **Step 3: Implement `MasterDataService`**

Create `apps/api/src/master-data/master-data.service.ts`:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Department } from './entities/department.entity.js';
import { Ward } from './entities/ward.entity.js';

export interface CreateDepartmentInput {
  departmentCode: string;
  departmentName: string;
  description?: string;
  isAppointmentApplicable?: boolean;
  parentDepartmentId?: string;
  roomNumber?: string;
  noticeText?: string;
}

export interface CreateWardInput {
  wardCode: string;
  wardName: string;
  wardType?: string;
  bedCapacity?: number;
}

@Injectable()
export class MasterDataService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createDepartment(input: CreateDepartmentInput): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const existing = await repository.findOne({ where: { departmentCode: input.departmentCode } });
      if (existing) {
        throw new ConflictException(`Department code ${input.departmentCode} already exists`);
      }
      return repository.save(
        repository.create({
          departmentCode: input.departmentCode,
          departmentName: input.departmentName,
          description: input.description ?? null,
          isAppointmentApplicable: input.isAppointmentApplicable ?? false,
          parentDepartmentId: input.parentDepartmentId ?? null,
          roomNumber: input.roomNumber ?? null,
          noticeText: input.noticeText ?? null,
        }),
      );
    });
  }

  async listDepartments(): Promise<Department[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Department).find({ order: { createdAt: 'ASC' } }),
    );
  }

  async getDepartment(id: string): Promise<Department | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Department).findOne({ where: { id } }),
    );
  }

  async deactivateDepartment(id: string): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const department = await repository.findOne({ where: { id } });
      if (!department) {
        throw new NotFoundException(`Department ${id} not found`);
      }
      if (!department.isActive) {
        return department;
      }
      const activeChild = await repository.findOne({
        where: { parentDepartmentId: id, isActive: true },
      });
      if (activeChild) {
        throw new ConflictException(
          `Cannot deactivate department ${id}: it is still the parent of active department ${activeChild.id}`,
        );
      }
      department.isActive = false;
      return repository.save(department);
    });
  }

  async reactivateDepartment(id: string): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const department = await repository.findOne({ where: { id } });
      if (!department) {
        throw new NotFoundException(`Department ${id} not found`);
      }
      department.isActive = true;
      return repository.save(department);
    });
  }

  async createWard(input: CreateWardInput): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const existing = await repository.findOne({ where: { wardCode: input.wardCode } });
      if (existing) {
        throw new ConflictException(`Ward code ${input.wardCode} already exists`);
      }
      return repository.save(
        repository.create({
          wardCode: input.wardCode,
          wardName: input.wardName,
          wardType: input.wardType ?? null,
          bedCapacity: input.bedCapacity ?? null,
        }),
      );
    });
  }

  async listWards(): Promise<Ward[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Ward).find({ order: { createdAt: 'ASC' } }),
    );
  }

  async getWard(id: string): Promise<Ward | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Ward).findOne({ where: { id } }),
    );
  }

  async deactivateWard(id: string): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const ward = await repository.findOne({ where: { id } });
      if (!ward) {
        throw new NotFoundException(`Ward ${id} not found`);
      }
      if (!ward.isActive) {
        return ward;
      }
      ward.isActive = false;
      return repository.save(ward);
    });
  }

  async reactivateWard(id: string): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const ward = await repository.findOne({ where: { id } });
      if (!ward) {
        throw new NotFoundException(`Ward ${id} not found`);
      }
      ward.isActive = true;
      return repository.save(ward);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=master-data.service.integration-spec`

Expected: PASS — all 12 tests (6 departments + 6 wards).

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/master-data/master-data.service.ts new/code/apps/api/src/master-data/master-data.service.integration-spec.ts
git commit -m "feat: add MasterDataService (departments and wards CRUD)"
```

---

### Task 4: `MasterDataController`, `MasterDataModule`, and wiring into `AppModule`

**Files:**
- Create: `apps/api/src/master-data/dto/create-department.dto.ts`
- Create: `apps/api/src/master-data/dto/create-ward.dto.ts`
- Create: `apps/api/src/master-data/master-data.controller.ts`
- Test: `apps/api/src/master-data/master-data.controller.integration-spec.ts`
- Create: `apps/api/src/master-data/master-data.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `MasterDataService` (Task 3), `PermissionGuard`/`RequirePermission` from `@hospital/auth-guards`, `DatabaseModule`, the `master-data.manage` permission (Task 1).
- Produces: `POST/GET /departments`, `GET/PATCH /departments/:id[/deactivate|/reactivate]`, same shape for `/wards` — all gated by `master-data.manage`.

- [ ] **Step 1: Write the DTOs and the failing tests**

Create `apps/api/src/master-data/dto/create-department.dto.ts`:

```typescript
export class CreateDepartmentDto {
  departmentCode!: string;
  departmentName!: string;
  description?: string;
  isAppointmentApplicable?: boolean;
  parentDepartmentId?: string;
  roomNumber?: string;
  noticeText?: string;
}
```

Create `apps/api/src/master-data/dto/create-ward.dto.ts`:

```typescript
export class CreateWardDto {
  wardCode!: string;
  wardName!: string;
  wardType?: string;
  bedCapacity?: number;
}
```

Create `apps/api/src/master-data/master-data.controller.integration-spec.ts`. Unlike the `tenants` module from an earlier plan, `departments`/`wards` are tenant-scoped (`MasterDataService` uses `TenantConnectionService.runInTenantSchema`, which throws if no tenant context is active) — this test must provision a real tenant schema and wire `TenantContextMiddleware` into the test app, exactly like `AccountsController`'s integration test does:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataModule } from './master-data.module.js';

describe('MasterDataController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const adminHeaders = {
    'x-tenant-id': 'test_masterdata_ctrl',
    'x-permissions': 'master-data.manage',
  };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const tenantConnection = moduleRef.get(TenantConnectionService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_ctrl');

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_ctrl" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('creates a department and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'CTRL1', departmentName: 'Ctrl Cardiology' });

    expect(response.status).toBe(201);
    expect(response.body.departmentCode).toBe('CTRL1');
    expect(response.body.isActive).toBe(true);
  });

  it('rejects a duplicate departmentCode with 409', async () => {
    await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department' });

    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department Again' });

    expect(response.status).toBe(409);
  });

  it('lists departments and gets a single one, 404 for an unknown one', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'GETDEPT', departmentName: 'Get Department' });

    const list = await request(app.getHttpServer()).get('/departments').set(adminHeaders);
    expect(list.status).toBe(200);
    expect(list.body.some((d: { departmentCode: string }) => d.departmentCode === 'GETDEPT')).toBe(true);

    const found = await request(app.getHttpServer())
      .get(`/departments/${created.body.id}`)
      .set(adminHeaders);
    expect(found.status).toBe(200);
    expect(found.body.departmentName).toBe('Get Department');

    const missing = await request(app.getHttpServer())
      .get('/departments/00000000-0000-0000-0000-000000000000')
      .set(adminHeaders);
    expect(missing.status).toBe(404);
  });

  it('deactivates and reactivates a department', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'LIFECYCLE', departmentName: 'Lifecycle Department' });

    const deactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/deactivate`)
      .set(adminHeaders);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const reactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/reactivate`)
      .set(adminHeaders);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.isActive).toBe(true);
  });

  it('creates, lists, and deactivates a ward', async () => {
    const created = await request(app.getHttpServer())
      .post('/wards')
      .set(adminHeaders)
      .send({ wardCode: 'W1', wardName: 'Ctrl Ward', bedCapacity: 10 });
    expect(created.status).toBe(201);
    expect(created.body.bedCapacity).toBe(10);

    const list = await request(app.getHttpServer()).get('/wards').set(adminHeaders);
    expect(list.status).toBe(200);
    expect(list.body.some((w: { wardCode: string }) => w.wardCode === 'W1')).toBe(true);

    const deactivated = await request(app.getHttpServer())
      .patch(`/wards/${created.body.id}/deactivate`)
      .set(adminHeaders);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);
  });
});
```

This test provisions a real, disposable `tenant_test_masterdata_ctrl` schema (dropped via `DROP SCHEMA ... CASCADE` in `afterAll`, exactly like `AccountsController`'s test) — no manual per-row cleanup needed, since the whole schema disappears at the end. Department/ward codes here don't need a `test_` prefix for cleanup purposes (the schema itself is the isolation boundary), but stay short and readable since the test data never leaks into another tenant's schema regardless.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=master-data.controller.integration-spec`

Expected: FAIL with `Cannot find module './master-data.module.js'` (nothing built yet).

- [ ] **Step 3: Implement `MasterDataController`**

Create `apps/api/src/master-data/master-data.controller.ts`:

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
import { MasterDataService } from './master-data.service.js';
import { CreateDepartmentDto } from './dto/create-department.dto.js';
import { CreateWardDto } from './dto/create-ward.dto.js';

const REQUIRED_PERMISSION = 'master-data.manage';

@Controller()
@UseGuards(PermissionGuard)
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  @Post('departments')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createDepartment(@Body() body: CreateDepartmentDto) {
    return this.masterDataService.createDepartment(body);
  }

  @Get('departments')
  @RequirePermission(REQUIRED_PERMISSION)
  async listDepartments() {
    return this.masterDataService.listDepartments();
  }

  @Get('departments/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getDepartment(@Param('id') id: string) {
    const department = await this.masterDataService.getDepartment(id);
    if (!department) {
      throw new NotFoundException(`Department ${id} not found`);
    }
    return department;
  }

  @Patch('departments/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateDepartment(@Param('id') id: string) {
    return this.masterDataService.deactivateDepartment(id);
  }

  @Patch('departments/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateDepartment(@Param('id') id: string) {
    return this.masterDataService.reactivateDepartment(id);
  }

  @Post('wards')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createWard(@Body() body: CreateWardDto) {
    return this.masterDataService.createWard(body);
  }

  @Get('wards')
  @RequirePermission(REQUIRED_PERMISSION)
  async listWards() {
    return this.masterDataService.listWards();
  }

  @Get('wards/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getWard(@Param('id') id: string) {
    const ward = await this.masterDataService.getWard(id);
    if (!ward) {
      throw new NotFoundException(`Ward ${id} not found`);
    }
    return ward;
  }

  @Patch('wards/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateWard(@Param('id') id: string) {
    return this.masterDataService.deactivateWard(id);
  }

  @Patch('wards/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateWard(@Param('id') id: string) {
    return this.masterDataService.reactivateWard(id);
  }
}
```

`@Controller()` has no base prefix — each route method declares its own full path (`'departments'`, `'wards'`, etc.) since this one controller intentionally owns two resource paths under one shared permission.

- [ ] **Step 4: Create `MasterDataModule`**

Create `apps/api/src/master-data/master-data.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { MasterDataController } from './master-data.controller.js';
import { MasterDataService } from './master-data.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
```

- [ ] **Step 5: Wire `MasterDataModule` into `AppModule`**

In `apps/api/src/app/app.module.ts`, add the import and add `MasterDataModule` to the `imports` array:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=master-data.controller.integration-spec`

Expected: PASS — all 5 tests.

- [ ] **Step 7: Run the full suite twice in a row**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: identical results both times, all suites passing, 0 typecheck errors — running it twice back-to-back confirms the disposable per-test tenant schema (dropped in `afterAll`) leaves nothing behind, so this test file is safely re-runnable against the persistent dev database.

- [ ] **Step 8: Commit**

```bash
git add new/code/apps/api/src/master-data/dto/create-department.dto.ts new/code/apps/api/src/master-data/dto/create-ward.dto.ts new/code/apps/api/src/master-data/master-data.controller.ts new/code/apps/api/src/master-data/master-data.controller.integration-spec.ts new/code/apps/api/src/master-data/master-data.module.ts new/code/apps/api/src/app/app.module.ts
git commit -m "feat: add MasterDataController and wire MasterDataModule into AppModule"
```

---

### Task 5: Cross-cutting permission-gating test

**Files:**
- Test: `apps/api/src/master-data/master-data-permission-gating.integration-spec.ts`

**Interfaces:** Consumes `MasterDataModule` (Task 4). No implementation changes — test coverage only, mirroring the equivalent tests already written for `AccountsController` and `TenantsController`.

- [ ] **Step 1: Write the test**

Create `apps/api/src/master-data/master-data-permission-gating.integration-spec.ts`. As in Task 4, `MasterDataService` requires an active tenant context — the `beforeAll` setup call must run inside `tenantContext.run(...)` against a provisioned tenant schema, matching `AccountsController permission gating`'s established pattern:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataModule } from './master-data.module.js';
import { MasterDataService } from './master-data.service.js';

describe('MasterDataController permission gating (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let departmentId: string;

  const noPermissionHeaders = { 'x-tenant-id': 'test_masterdata_permgate' };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const tenantConnection = moduleRef.get(TenantConnectionService);
    const masterDataService = moduleRef.get(MasterDataService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_permgate');

    const department = await tenantContext.run(
      { tenantId: 'test_masterdata_permgate', correlationId: 'setup' },
      () =>
        masterDataService.createDepartment({
          departmentCode: 'PERMGATE',
          departmentName: 'Permission Gate Department',
        }),
    );
    departmentId = department.id;

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_permgate" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('rejects creating a department with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(noPermissionHeaders)
      .send({ departmentCode: 'BLOCKED', departmentName: 'Blocked Department' });
    expect(response.status).toBe(403);
  });

  it('rejects listing departments with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/departments').set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single department with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get(`/departments/${departmentId}`)
      .set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects department deactivate/reactivate with 403 when no master-data.manage permission is granted', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/deactivate`)
      .set(noPermissionHeaders);
    expect(deactivateResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/reactivate`)
      .set(noPermissionHeaders);
    expect(reactivateResponse.status).toBe(403);
  });

  it('rejects creating and listing wards with 403 when no master-data.manage permission is granted', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/wards')
      .set(noPermissionHeaders)
      .send({ wardCode: 'BLOCKED', wardName: 'Blocked Ward' });
    expect(createResponse.status).toBe(403);

    const listResponse = await request(app.getHttpServer()).get('/wards').set(noPermissionHeaders);
    expect(listResponse.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm exec nx test api --testPathPatterns=master-data-permission-gating.integration-spec`

Expected: PASS — all 5 tests, first try (this mirrors an already-proven pattern; `PermissionGuard` behavior itself is not new).

- [ ] **Step 3: Run the full suite twice in a row**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: identical results both times, all suites passing, 0 typecheck errors.

- [ ] **Step 4: Commit**

```bash
git add new/code/apps/api/src/master-data/master-data-permission-gating.integration-spec.ts
git commit -m "test: add cross-cutting 403 coverage for every master-data route without master-data.manage"
```
