# Admission (ADT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Admission/Discharge/Transfer (ADT) for inpatient care — admit a patient to a bed (directly, from an Appointment, or from a linked Triage entry), transfer them between beds, and discharge them — per `docs/superpowers/specs/2026-07-31-admission-adt-design.md`.

**Architecture:** A `Bed` entity is added to the existing `MasterDataModule` (`apps/api/src/master-data/`), alongside `Department`/`Ward`. A new `AdmissionsModule` (`apps/api/src/admissions/`) owns `Admission` and `BedTransfer`, following the exact NestJS Controller → Service → TypeORM pattern already used by `VitalsModule`/`TriageModule`: tenant-scoped via `TenantConnectionService`, one shared `EntityManager` per request so `AdmissionsService` can read/write the `Bed` entity directly (same Postgres schema, just a different module's entity class) without depending on `MasterDataService`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest — unchanged from the rest of `apps/api`.

## Global Constraints

- Tenant data isolation via `TenantConnectionService` is mandatory for all operations.
- Authorization via `@RequirePermission` and `PermissionGuard` is mandatory for all endpoints.
- TypeORM entities must be registered in `apps/api/src/database/data-source.ts` (both the `entities` and `migrations` arrays).
- Every new migration must be invoked explicitly in `AccountsService.provisionTenantSchema` (`apps/api/src/accounts/accounts.service.ts`) — registering it in `data-source.ts` alone does **not** create the table in tenant schemas. (A prior task in this repo's history got this wrong for the triage migration; it silently never ran until caught by a test failure.)
- Nullable entity columns must be typed `field!: T | null` (required key, nullable value) and use TypeORM's `nullable: true`, never a bare `field?: T`. Input/DTO interfaces for those columns should instead mark the field itself optional (`field?: T`) — do not derive `Create*Input` types via `Omit<Entity, ...>`, since that inherits the entity's required-but-nullable shape and forces every caller to pass `null` explicitly for every optional field.
- DTO field names passed straight through to a service must match the service's `Create*Input`/`Update*Input` field names exactly. TypeScript will not catch a mismatch here (excess/renamed properties on a variable — as opposed to an object literal — pass structural typing silently), so this has caused a real, silent data-loss bug once already in this codebase (Vitals DTOs). Double-check field names by eye against the `Input` type, not just by running typecheck.
- Every relative import needs an explicit `.js` extension (NodeNext module resolution). Run `pnpm exec nx run-many -t typecheck test` (not just `test`) from `new/code` before considering any task done.
- Follow this workspace's git conventions: never `git commit --amend`, never add AI co-authorship trailers, `git add` specific files (never `-A`).

---

### Task 1: `Bed` entity and migration

**Files:**
- Create: `apps/api/src/master-data/entities/bed.entity.ts`
- Create: `apps/api/src/database/migrations/0013-create-beds-table.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: `Bed` entity (table `beds`) — consumed by `MasterDataService` (Task 2) and `AdmissionsService` (Task 5).

There is no test for this task in isolation (an entity/migration with nothing atop it has nothing meaningful to assert); Task 2's tests are the first thing that exercises this table.

- [ ] **Step 1: Create the entity**

```typescript
// apps/api/src/master-data/entities/bed.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('beds')
export class Bed {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  wardId!: string;

  @Column()
  bedNumber!: string;

  @Column({ type: 'varchar', nullable: true })
  bedType!: string | null;

  @Column({ type: 'varchar', default: 'Available' })
  status!: string; // 'Available' | 'Occupied' | 'Maintenance'

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
```

- [ ] **Step 2: Create the migration**

```typescript
// apps/api/src/database/migrations/0013-create-beds-table.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBedsTable0013 implements MigrationInterface {
  name = 'CreateBedsTable0013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE beds (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "wardId" uuid NOT NULL,
        "bedNumber" varchar NOT NULL,
        "bedType" varchar NULL,
        status varchar NOT NULL DEFAULT 'Available',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_beds_ward_bed_number" UNIQUE ("wardId", "bedNumber")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE beds`);
  }
}
```

- [ ] **Step 3: Register the entity and migration in `data-source.ts`**

In `apps/api/src/database/data-source.ts`, add the imports:

```typescript
import { Bed } from '../master-data/entities/bed.entity.js';
import { CreateBedsTable0013 } from './migrations/0013-create-beds-table.js';
```

Change the `entities` and `migrations` arrays in `createDataSource()` from:

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable, CreatePatientTables005, CreateVitalsTable0010, CreateTriageTable0012],
```

to:

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable, CreatePatientTables005, CreateVitalsTable0010, CreateTriageTable0012, CreateBedsTable0013],
```

- [ ] **Step 4: Invoke the migration in `provisionTenantSchema`**

In `apps/api/src/accounts/accounts.service.ts`, add the import:

```typescript
import { CreateBedsTable0013 } from '../database/migrations/0013-create-beds-table.js';
```

In `provisionTenantSchema`, immediately after the `triageMigration.up(queryRunner)` line, add:

```typescript
      const bedsMigration = new CreateBedsTable0013();
      await bedsMigration.up(queryRunner);
```

- [ ] **Step 5: Verify typecheck passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t typecheck --skip-nx-cache
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add new/code/apps/api/src/master-data/entities/bed.entity.ts new/code/apps/api/src/database/migrations/0013-create-beds-table.ts new/code/apps/api/src/database/data-source.ts new/code/apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add Bed entity and migration"
```

---

### Task 2: `Bed` CRUD in `MasterDataService`/`MasterDataController`

**Files:**
- Modify: `apps/api/src/master-data/master-data.service.ts`
- Modify: `apps/api/src/master-data/master-data.service.integration-spec.ts`
- Create: `apps/api/src/master-data/dto/create-bed.dto.ts`
- Modify: `apps/api/src/master-data/master-data.controller.ts`
- Modify: `apps/api/src/master-data/master-data.controller.integration-spec.ts`

**Interfaces:**
- Consumes: `Bed` entity (Task 1), `TenantConnectionService`.
- Produces: `MasterDataService.createBed(input: CreateBedInput): Promise<Bed>`, `listBedsByWard(wardId: string): Promise<Bed[]>`, `getBed(id: string): Promise<Bed | null>`, `deactivateBed(id: string): Promise<Bed>`, `reactivateBed(id: string): Promise<Bed>` — `getBed`/`listBedsByWard` are consumed by `AdmissionsService` in Task 5 for bed-availability checks. `CreateBedInput = { wardId: string; bedNumber: string; bedType?: string }`.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `apps/api/src/master-data/master-data.service.integration-spec.ts`, right after the closing `});` of the existing `describe('wards', ...)` block (so it's a sibling, still inside the outer `describe('MasterDataService (integration)', ...)`):

```typescript
  describe('beds', () => {
    it('creates a bed as available under a ward', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'ICU', wardName: 'ICU' }));
      const bed = await inTenant(() =>
        masterDataService.createBed({ wardId: ward.id, bedNumber: '1', bedType: 'ICU' }),
      );
      expect(bed.wardId).toBe(ward.id);
      expect(bed.bedNumber).toBe('1');
      expect(bed.status).toBe('Available');
      expect(bed.isActive).toBe(true);
    });

    it('rejects a duplicate bedNumber within the same ward with 409', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN1', wardName: 'General 1' }));
      await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: 'A1' }));

      await expect(
        inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: 'A1' })),
      ).rejects.toThrow(ConflictException);
    });

    it('allows the same bedNumber in two different wards', async () => {
      const wardA = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN2A', wardName: 'General 2A' }));
      const wardB = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN2B', wardName: 'General 2B' }));
      await inTenant(() => masterDataService.createBed({ wardId: wardA.id, bedNumber: '1' }));

      const bedB = await inTenant(() => masterDataService.createBed({ wardId: wardB.id, bedNumber: '1' }));
      expect(bedB.wardId).toBe(wardB.id);
    });

    it('rejects creating a bed under an unknown ward with 404', async () => {
      await expect(
        inTenant(() =>
          masterDataService.createBed({ wardId: '00000000-0000-0000-0000-000000000000', bedNumber: '1' }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('lists beds by ward and gets a single bed, returns null for an unknown id', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN3', wardName: 'General 3' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));

      const beds = await inTenant(() => masterDataService.listBedsByWard(ward.id));
      expect(beds.some((b) => b.id === bed.id)).toBe(true);

      const found = await inTenant(() => masterDataService.getBed(bed.id));
      expect(found?.bedNumber).toBe('1');

      const missing = await inTenant(() => masterDataService.getBed('00000000-0000-0000-0000-000000000000'));
      expect(missing).toBeNull();
    });

    it('deactivates and reactivates a bed', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN4', wardName: 'General 4' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));

      const deactivated = await inTenant(() => masterDataService.deactivateBed(bed.id));
      expect(deactivated.isActive).toBe(false);

      const reactivated = await inTenant(() => masterDataService.reactivateBed(bed.id));
      expect(reactivated.isActive).toBe(true);
    });

    it('rejects deactivating an occupied bed with 409', async () => {
      const ward = await inTenant(() => masterDataService.createWard({ wardCode: 'GEN5', wardName: 'General 5' }));
      const bed = await inTenant(() => masterDataService.createBed({ wardId: ward.id, bedNumber: '1' }));
      // Simulate occupancy the same way AdmissionsService will (Task 5) — directly via the repository,
      // since MasterDataService itself never sets status to 'Occupied'. `tenantConnection` and `Bed`
      // are already in scope in this file (the existing top-of-file setup and the import added below).
      await inTenant(() =>
        tenantConnection.runInTenantSchema(async (manager) => {
          const repo = manager.getRepository(Bed);
          const occupied = await repo.findOneOrFail({ where: { id: bed.id } });
          occupied.status = 'Occupied';
          await repo.save(occupied);
        }),
      );

      await expect(inTenant(() => masterDataService.deactivateBed(bed.id))).rejects.toThrow(ConflictException);
    });

    it('deactivate/reactivate on an unknown id throws NotFoundException', async () => {
      await expect(
        inTenant(() => masterDataService.deactivateBed('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
      await expect(
        inTenant(() => masterDataService.reactivateBed('00000000-0000-0000-0000-000000000000')),
      ).rejects.toThrow(NotFoundException);
    });
  });
```

This test file needs one more import at the top, added alongside the existing ones: `import { Bed } from './entities/bed.entity.js';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=master-data.service.integration-spec`
Expected: FAIL — `masterDataService.createBed is not a function`.

- [ ] **Step 3: Create the DTO**

```typescript
// apps/api/src/master-data/dto/create-bed.dto.ts
export class CreateBedDto {
  bedNumber!: string;
  bedType?: string;
}
```

(`wardId` is not on this DTO — it comes from the `POST /wards/:wardId/beds` URL path, not the request body; see Step 5.)

- [ ] **Step 4: Implement the service methods**

In `apps/api/src/master-data/master-data.service.ts`, add the import:

```typescript
import { Bed } from './entities/bed.entity.js';
```

Add this interface alongside the existing `CreateWardInput`:

```typescript
export interface CreateBedInput {
  wardId: string;
  bedNumber: string;
  bedType?: string;
}
```

Add these methods to `MasterDataService`, after the existing `reactivateWard` method (still inside the class body, before the closing `}`):

```typescript
  async createBed(input: CreateBedInput): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const ward = await manager.getRepository(Ward).findOne({ where: { id: input.wardId } });
      if (!ward) {
        throw new NotFoundException(`Ward ${input.wardId} not found`);
      }

      const repository = manager.getRepository(Bed);
      const existing = await repository.findOne({ where: { wardId: input.wardId, bedNumber: input.bedNumber } });
      if (existing) {
        throw new ConflictException(`Bed ${input.bedNumber} already exists in ward ${input.wardId}`);
      }

      return repository.save(
        repository.create({
          wardId: input.wardId,
          bedNumber: input.bedNumber,
          bedType: input.bedType ?? null,
          status: 'Available',
          isActive: true,
        }),
      );
    });
  }

  async listBedsByWard(wardId: string): Promise<Bed[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Bed).find({ where: { wardId }, order: { bedNumber: 'ASC' } }),
    );
  }

  async getBed(id: string): Promise<Bed | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Bed).findOne({ where: { id } }),
    );
  }

  async deactivateBed(id: string): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Bed);
      const bed = await repository.findOne({ where: { id } });
      if (!bed) {
        throw new NotFoundException(`Bed ${id} not found`);
      }
      if (bed.status === 'Occupied') {
        throw new ConflictException(`Cannot deactivate bed ${id}: it is currently occupied`);
      }
      if (!bed.isActive) {
        return bed;
      }
      bed.isActive = false;
      return repository.save(bed);
    });
  }

  async reactivateBed(id: string): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Bed);
      const bed = await repository.findOne({ where: { id } });
      if (!bed) {
        throw new NotFoundException(`Bed ${id} not found`);
      }
      bed.isActive = true;
      return repository.save(bed);
    });
  }
```

- [ ] **Step 5: Add the controller endpoints**

In `apps/api/src/master-data/master-data.controller.ts`, add the import:

```typescript
import { CreateBedDto } from './dto/create-bed.dto.js';
```

Add these endpoints after the existing `reactivateWard` method (still inside the class body, before the closing `}`):

```typescript
  @Post('wards/:wardId/beds')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async createBed(@Param('wardId') wardId: string, @Body() body: CreateBedDto) {
    return this.masterDataService.createBed({ ...body, wardId });
  }

  @Get('wards/:wardId/beds')
  @RequirePermission(REQUIRED_PERMISSION)
  async listBedsByWard(@Param('wardId') wardId: string) {
    return this.masterDataService.listBedsByWard(wardId);
  }

  @Get('beds/:id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getBed(@Param('id') id: string) {
    const bed = await this.masterDataService.getBed(id);
    if (!bed) {
      throw new NotFoundException(`Bed ${id} not found`);
    }
    return bed;
  }

  @Patch('beds/:id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivateBed(@Param('id') id: string) {
    return this.masterDataService.deactivateBed(id);
  }

  @Patch('beds/:id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivateBed(@Param('id') id: string) {
    return this.masterDataService.reactivateBed(id);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=master-data.service.integration-spec`
Expected: PASS — all tests including the new `beds` block.

- [ ] **Step 7: Add controller-level coverage**

Add this test to `apps/api/src/master-data/master-data.controller.integration-spec.ts`, following the existing tests' pattern in that file (reuse the same `app`/`adminHeaders` setup already in the file — do not duplicate `beforeAll`):

```typescript
  it('creates a bed under a ward and lists it', async () => {
    const wardResponse = await request(app.getHttpServer())
      .post('/wards')
      .set(adminHeaders)
      .send({ wardCode: 'CTRLBED', wardName: 'Ctrl Bed Ward' });
    expect(wardResponse.status).toBe(201);

    const bedResponse = await request(app.getHttpServer())
      .post(`/wards/${wardResponse.body.id}/beds`)
      .set(adminHeaders)
      .send({ bedNumber: '1', bedType: 'General' });
    expect(bedResponse.status).toBe(201);
    expect(bedResponse.body.wardId).toBe(wardResponse.body.id);

    const listResponse = await request(app.getHttpServer())
      .get(`/wards/${wardResponse.body.id}/beds`)
      .set(adminHeaders);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((b: { id: string }) => b.id === bedResponse.body.id)).toBe(true);
  });
```

- [ ] **Step 8: Run the full suite**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache
```

Expected: all suites pass, 0 typecheck errors.

- [ ] **Step 9: Commit**

```bash
git add new/code/apps/api/src/master-data/master-data.service.ts new/code/apps/api/src/master-data/master-data.service.integration-spec.ts new/code/apps/api/src/master-data/dto/create-bed.dto.ts new/code/apps/api/src/master-data/master-data.controller.ts new/code/apps/api/src/master-data/master-data.controller.integration-spec.ts
git commit -m "feat: add Bed CRUD to MasterDataService/MasterDataController"
```

---

### Task 3: Seed `admission.manage` / `admission.read` permissions

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`

**Interfaces:**
- Produces: `admission.manage` (Doctor, Nurse, Hospital Admin, Super Admin) and `admission.read` (adds Receptionist/Front Desk) permissions — consumed by `AdmissionsController` in Task 6.

- [ ] **Step 1: Write the failing test**

Add this test to `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`, in the same style as the existing `'maps triage.manage to ...'`-style tests already in that file (find the block that asserts role mappings for `triage.manage`/`triage.read` and add a sibling `it` block right after it, still inside the same `describe`):

```typescript
  it('maps admission.manage to Doctor, Nurse, Hospital Admin, Super Admin and admission.read additionally to Receptionist', async () => {
    await seedRbacCatalog(dataSource);

    const managePermission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'admission.manage' },
    });
    const manageMappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: managePermission.id },
    });
    const manageRoles = await dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m) => m.roleId)) } });
    expect(manageRoles.map((r) => r.name).sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Super Admin']);

    const readPermission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'admission.read' },
    });
    const readMappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: readPermission.id },
    });
    const readRoles = await dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m) => m.roleId)) } });
    expect(readRoles.map((r) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Nurse',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog`
Expected: FAIL — permission `admission.manage` not found.

- [ ] **Step 3: Add the permissions and role mappings**

In `apps/api/src/rbac/seed-rbac-catalog.ts`, add to `PERMISSION_CATALOG` (after the `triage.read` entry):

```typescript
  {
    name: 'admission.manage',
    description: 'Admit, transfer, and discharge inpatients',
  },
  {
    name: 'admission.read',
    description: 'View inpatient admissions',
  },
```

Add to `ROLE_PERMISSION_MAPPINGS` (after the last `triage.read` mapping):

```typescript
  { roleName: 'Super Admin', permissionName: 'admission.manage' },
  { roleName: 'Super Admin', permissionName: 'admission.read' },
  { roleName: 'Hospital Admin', permissionName: 'admission.manage' },
  { roleName: 'Hospital Admin', permissionName: 'admission.read' },
  { roleName: 'Doctor', permissionName: 'admission.manage' },
  { roleName: 'Doctor', permissionName: 'admission.read' },
  { roleName: 'Nurse', permissionName: 'admission.manage' },
  { roleName: 'Nurse', permissionName: 'admission.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'admission.read' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/rbac/seed-rbac-catalog.ts new/code/apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: seed admission.manage and admission.read permissions"
```

---

### Task 4: `Admission` and `BedTransfer` entities and migration

**Files:**
- Create: `apps/api/src/admissions/entities/admission.entity.ts`
- Create: `apps/api/src/admissions/entities/bed-transfer.entity.ts`
- Create: `apps/api/src/database/migrations/0014-create-admissions-tables.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: `Admission` entity (table `admissions`) and `BedTransfer` entity (table `bed_transfers`) — consumed by `AdmissionsService` in Task 5.

No test in isolation, same reasoning as Task 1 — Task 5's tests are the first thing that exercises these tables.

- [ ] **Step 1: Create the `Admission` entity**

```typescript
// apps/api/src/admissions/entities/admission.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('admissions')
export class Admission {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'varchar' })
  admissionSource!: string; // 'OPD' | 'ER' | 'Direct'

  @Column({ type: 'uuid', nullable: true })
  sourceAppointmentId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceTriageEntryId!: string | null;

  @Column({ type: 'uuid' })
  admittingDoctorId!: string;

  @Column({ type: 'uuid' })
  wardId!: string;

  @Column({ type: 'uuid' })
  bedId!: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  admissionDate!: Date;

  @Column({ type: 'varchar', default: 'Admitted' })
  status!: string; // 'Admitted' | 'Discharged'

  @Column({ type: 'timestamptz', nullable: true })
  dischargeDate!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  dischargeType!: string | null;

  @Column({ type: 'varchar', nullable: true })
  dischargeCondition!: string | null;

  @Column({ type: 'text', nullable: true })
  dischargeSummary!: string | null;

  @Column({ type: 'uuid', nullable: true })
  dischargedBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Create the `BedTransfer` entity**

```typescript
// apps/api/src/admissions/entities/bed-transfer.entity.ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('bed_transfers')
export class BedTransfer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  admissionId!: string;

  @Column({ type: 'uuid', nullable: true })
  fromBedId!: string | null;

  @Column({ type: 'uuid' })
  toBedId!: string;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  transferredAt!: Date;

  @Column({ type: 'uuid' })
  transferredBy!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 3: Create the migration**

```typescript
// apps/api/src/database/migrations/0014-create-admissions-tables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdmissionsTables0014 implements MigrationInterface {
  name = 'CreateAdmissionsTables0014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "admissionSource" varchar NOT NULL,
        "sourceAppointmentId" uuid NULL,
        "sourceTriageEntryId" uuid NULL,
        "admittingDoctorId" uuid NOT NULL,
        "wardId" uuid NOT NULL,
        "bedId" uuid NOT NULL,
        "admissionDate" timestamptz NOT NULL DEFAULT now(),
        status varchar NOT NULL DEFAULT 'Admitted',
        "dischargeDate" timestamptz NULL,
        "dischargeType" varchar NULL,
        "dischargeCondition" varchar NULL,
        "dischargeSummary" text NULL,
        "dischargedBy" uuid NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_admissions_active_bed" ON admissions ("bedId") WHERE status = 'Admitted'
    `);
    await queryRunner.query(`
      CREATE TABLE bed_transfers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "fromBedId" uuid NULL,
        "toBedId" uuid NOT NULL,
        "transferredAt" timestamptz NOT NULL DEFAULT now(),
        "transferredBy" uuid NOT NULL,
        reason text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE bed_transfers`);
    await queryRunner.query(`DROP TABLE admissions`);
  }
}
```

- [ ] **Step 4: Register the entities and migration in `data-source.ts`**

Add the imports:

```typescript
import { Admission } from '../admissions/entities/admission.entity.js';
import { BedTransfer } from '../admissions/entities/bed-transfer.entity.js';
import { CreateAdmissionsTables0014 } from './migrations/0014-create-admissions-tables.js';
```

Change the `entities` and `migrations` arrays in `createDataSource()` (this is Task 1's result, from `apps/api/src/database/data-source.ts`) from:

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable, CreatePatientTables005, CreateVitalsTable0010, CreateTriageTable0012, CreateBedsTable0013],
```

to:

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable, CreatePatientTables005, CreateVitalsTable0010, CreateTriageTable0012, CreateBedsTable0013, CreateAdmissionsTables0014],
```

- [ ] **Step 5: Invoke the migration in `provisionTenantSchema`**

In `apps/api/src/accounts/accounts.service.ts`, add the import:

```typescript
import { CreateAdmissionsTables0014 } from '../database/migrations/0014-create-admissions-tables.js';
```

Immediately after the `bedsMigration.up(queryRunner)` line added in Task 1, add:

```typescript
      const admissionsMigration = new CreateAdmissionsTables0014();
      await admissionsMigration.up(queryRunner);
```

- [ ] **Step 6: Verify typecheck passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t typecheck --skip-nx-cache
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add new/code/apps/api/src/admissions/entities/admission.entity.ts new/code/apps/api/src/admissions/entities/bed-transfer.entity.ts new/code/apps/api/src/database/migrations/0014-create-admissions-tables.ts new/code/apps/api/src/database/data-source.ts new/code/apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add Admission and BedTransfer entities and migration"
```

---

### Task 5: `AdmissionsService`

**Files:**
- Create: `apps/api/src/admissions/admissions.service.ts`
- Create: `apps/api/src/admissions/admissions.service.integration-spec.ts`

**Interfaces:**
- Consumes: `Admission`, `BedTransfer` entities (Task 4); `Bed` entity (Task 1, imported directly — same tenant schema, no `MasterDataService` dependency); `TriageEntry` entity (already exists at `apps/api/src/clinical/triage/entities/triage-entry.entity.js`); `TenantConnectionService`.
- Produces: `AdmissionsService` with `admit(input: CreateAdmissionInput): Promise<Admission>`, `findOne(id: string): Promise<Admission>`, `listActive(wardId?: string): Promise<Admission[]>`, `transfer(id: string, input: TransferAdmissionInput): Promise<Admission>`, `discharge(id: string, input: DischargeAdmissionInput): Promise<Admission>` — consumed by `AdmissionsController` in Task 6.
  - `CreateAdmissionInput = { patientId: string; admissionSource: string; sourceAppointmentId?: string; sourceTriageEntryId?: string; admittingDoctorId: string; bedId: string }`. `admissionSource` is plain `string` (expected values: `'OPD'`, `'ER'`, `'Direct'`), matching the `Admission` entity's own column type and this codebase's established convention of not using TypeScript literal-union types for enum-like columns (see `Vital`/`TriageEntry`) — a literal union here would reject the DTO's `string`-typed field at the controller→service call site in Task 6. Note: **no `wardId` field** — the service derives `wardId` from the bed's own `wardId` rather than trusting a possibly-inconsistent caller-supplied value.
  - `TransferAdmissionInput = { toBedId: string; transferredBy: string; reason?: string }`.
  - `DischargeAdmissionInput = { dischargedBy: string; dischargeType?: string; dischargeCondition?: string; dischargeSummary?: string }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/admissions/admissions.service.integration-spec.ts`:

```typescript
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TenantsService } from '../tenants/tenants.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { TriageService } from '../clinical/triage/triage.service.js';
import { AdmissionsService } from './admissions.service.js';

describe('AdmissionsService (integration)', () => {
  const dataSource = createDataSource();
  let tenantContextService: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let appointmentsService: AppointmentsService;
  let triageService: TriageService;
  let admissionsService: AdmissionsService;

  let tenantId1: string;
  let tenantId2: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);
    const patientSequence = new PatientNumberGeneratorService(tenantConnection);
    patientsService = new PatientsService(tenantConnection, patientSequence);
    masterDataService = new MasterDataService(tenantConnection);
    appointmentsService = new AppointmentsService(tenantConnection);
    triageService = new TriageService(tenantConnection);
    admissionsService = new AdmissionsService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `admissions_1_${uniqueId}`, hospitalName: 'Admissions Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `admissions_2_${uniqueId}`, hospitalName: 'Admissions Hospital 2' });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  async function makePatient(tenantId: string, phoneNumber: string) {
    return inTenant(tenantId, () =>
      patientsService.create({
        firstName: 'Test',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber,
      }),
    );
  }

  async function makeBed(tenantId: string, wardCode: string, bedNumber = '1') {
    const ward = await inTenant(tenantId, () => masterDataService.createWard({ wardCode, wardName: wardCode }));
    return inTenant(tenantId, () => masterDataService.createBed({ wardId: ward.id, bedNumber }));
  }

  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000d1';

  it('admits a patient directly and occupies the bed', async () => {
    const patient = await makePatient(tenantId1, '3330000001');
    const bed = await makeBed(tenantId1, 'ADT1');

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'Direct',
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.status).toBe('Admitted');
    expect(admission.wardId).toBe(bed.wardId);
    expect(admission.bedId).toBe(bed.id);

    const occupiedBed = await inTenant(tenantId1, () => masterDataService.getBed(bed.id));
    expect(occupiedBed?.status).toBe('Occupied');
  });

  it('admits from an appointment source', async () => {
    const patient = await makePatient(tenantId1, '3330000002');
    const bed = await makeBed(tenantId1, 'ADT2');
    const appointment = await inTenant(tenantId1, () =>
      appointmentsService.create({
        patientId: patient.id,
        firstName: 'Test',
        lastName: 'Patient',
        contactNumber: '3330000002',
        appointmentDate: '2026-08-01',
        appointmentTime: '10:00',
        appointmentType: 'OPD',
      }),
    );

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'OPD',
        sourceAppointmentId: appointment.id,
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.sourceAppointmentId).toBe(appointment.id);
    expect(admission.sourceTriageEntryId).toBeNull();
  });

  it('admits from a linked triage entry', async () => {
    const patient = await makePatient(tenantId1, '3330000003');
    const bed = await makeBed(tenantId1, 'ADT3');
    const triageEntry = await inTenant(tenantId1, () => triageService.create({ chiefComplaint: 'Test' }));
    await inTenant(tenantId1, () => triageService.linkPatient(triageEntry.id, patient.id));

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({
        patientId: patient.id,
        admissionSource: 'ER',
        sourceTriageEntryId: triageEntry.id,
        admittingDoctorId: DOCTOR_ID,
        bedId: bed.id,
      }),
    );

    expect(admission.sourceTriageEntryId).toBe(triageEntry.id);
  });

  it('rejects admitting from an unlinked (anonymous) triage entry', async () => {
    const bed = await makeBed(tenantId1, 'ADT4');
    const anonymousEntry = await inTenant(tenantId1, () => triageService.create({ firstName: 'Unknown' }));

    await expect(
      inTenant(tenantId1, () =>
        admissionsService.admit({
          patientId: '00000000-0000-0000-0000-000000000000',
          admissionSource: 'ER',
          sourceTriageEntryId: anonymousEntry.id,
          admittingDoctorId: DOCTOR_ID,
          bedId: bed.id,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects providing both sourceAppointmentId and sourceTriageEntryId', async () => {
    const patient = await makePatient(tenantId1, '3330000005');
    const bed = await makeBed(tenantId1, 'ADT5');

    await expect(
      inTenant(tenantId1, () =>
        admissionsService.admit({
          patientId: patient.id,
          admissionSource: 'ER',
          sourceAppointmentId: '00000000-0000-0000-0000-000000000000',
          sourceTriageEntryId: '00000000-0000-0000-0000-000000000000',
          admittingDoctorId: DOCTOR_ID,
          bedId: bed.id,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects admitting into an already-occupied bed', async () => {
    const bed = await makeBed(tenantId1, 'ADT6');
    const patientA = await makePatient(tenantId1, '3330000006');
    const patientB = await makePatient(tenantId1, '3330000007');

    await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    await expect(
      inTenant(tenantId1, () =>
        admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('transfers a patient to a new bed, freeing the old one and occupying the new one', async () => {
    const patient = await makePatient(tenantId1, '3330000008');
    const bedA = await makeBed(tenantId1, 'ADT7', 'A');
    const bedB = await makeBed(tenantId1, 'ADT7', 'B');

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );

    const transferred = await inTenant(tenantId1, () =>
      admissionsService.transfer(admission.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID, reason: 'ICU step-down' }),
    );

    expect(transferred.bedId).toBe(bedB.id);
    expect(transferred.wardId).toBe(bedB.wardId);

    const freedBed = await inTenant(tenantId1, () => masterDataService.getBed(bedA.id));
    expect(freedBed?.status).toBe('Available');
    const occupiedBed = await inTenant(tenantId1, () => masterDataService.getBed(bedB.id));
    expect(occupiedBed?.status).toBe('Occupied');
  });

  it('rejects transferring into a non-available bed', async () => {
    const patientA = await makePatient(tenantId1, '3330000009');
    const patientB = await makePatient(tenantId1, '3330000010');
    const bedA = await makeBed(tenantId1, 'ADT8', 'A');
    const bedB = await makeBed(tenantId1, 'ADT8', 'B');

    const admissionA = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedB.id }),
    );

    await expect(
      inTenant(tenantId1, () => admissionsService.transfer(admissionA.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('discharges a patient, freeing the bed', async () => {
    const patient = await makePatient(tenantId1, '3330000011');
    const bed = await makeBed(tenantId1, 'ADT9');

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    const discharged = await inTenant(tenantId1, () =>
      admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID, dischargeType: 'Routine', dischargeCondition: 'Improved' }),
    );

    expect(discharged.status).toBe('Discharged');
    expect(discharged.dischargeDate).not.toBeNull();

    const freedBed = await inTenant(tenantId1, () => masterDataService.getBed(bed.id));
    expect(freedBed?.status).toBe('Available');
  });

  it('rejects transfer and discharge on an already-discharged admission', async () => {
    const patient = await makePatient(tenantId1, '3330000012');
    const bedA = await makeBed(tenantId1, 'ADT10', 'A');
    const bedB = await makeBed(tenantId1, 'ADT10', 'B');

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    await inTenant(tenantId1, () => admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID }));

    await expect(
      inTenant(tenantId1, () => admissionsService.transfer(admission.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
    await expect(
      inTenant(tenantId1, () => admissionsService.discharge(admission.id, { dischargedBy: DOCTOR_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('lists active admissions, optionally filtered by ward, excluding discharged ones', async () => {
    const patientA = await makePatient(tenantId2, '3330000013');
    const patientB = await makePatient(tenantId2, '3330000014');
    const bedA = await makeBed(tenantId2, 'ADTLIST_A');
    const bedB = await makeBed(tenantId2, 'ADTLIST_B');

    const admissionA = await inTenant(tenantId2, () =>
      admissionsService.admit({ patientId: patientA.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    const admissionB = await inTenant(tenantId2, () =>
      admissionsService.admit({ patientId: patientB.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedB.id }),
    );
    await inTenant(tenantId2, () => admissionsService.discharge(admissionB.id, { dischargedBy: DOCTOR_ID }));

    const all = await inTenant(tenantId2, () => admissionsService.listActive());
    expect(all.some((a) => a.id === admissionA.id)).toBe(true);
    expect(all.some((a) => a.id === admissionB.id)).toBe(false);

    const filtered = await inTenant(tenantId2, () => admissionsService.listActive(admissionA.wardId));
    expect(filtered.some((a) => a.id === admissionA.id)).toBe(true);
  });

  it('throws NotFoundException for an unknown admission id', async () => {
    await expect(
      inTenant(tenantId1, () => admissionsService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for admissions', async () => {
    const patient = await makePatient(tenantId1, '3330000015');
    const bed = await makeBed(tenantId1, 'ADTISO');

    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    await expect(
      inTenant(tenantId2, () => admissionsService.findOne(admission.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=admissions.service`
Expected: FAIL — `Cannot find module './admissions.service.js'`.

- [ ] **Step 3: Implement `AdmissionsService`**

Create `apps/api/src/admissions/admissions.service.ts`:

```typescript
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Admission } from './entities/admission.entity.js';
import { BedTransfer } from './entities/bed-transfer.entity.js';
import { Bed } from '../master-data/entities/bed.entity.js';
import { TriageEntry } from '../clinical/triage/entities/triage-entry.entity.js';

export interface CreateAdmissionInput {
  patientId: string;
  admissionSource: string; // expected: 'OPD' | 'ER' | 'Direct'
  sourceAppointmentId?: string;
  sourceTriageEntryId?: string;
  admittingDoctorId: string;
  bedId: string;
}

export interface TransferAdmissionInput {
  toBedId: string;
  transferredBy: string;
  reason?: string;
}

export interface DischargeAdmissionInput {
  dischargedBy: string;
  dischargeType?: string;
  dischargeCondition?: string;
  dischargeSummary?: string;
}

@Injectable()
export class AdmissionsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async admit(input: CreateAdmissionInput): Promise<Admission> {
    if (input.sourceAppointmentId && input.sourceTriageEntryId) {
      throw new BadRequestException(
        'An admission can have at most one source: sourceAppointmentId or sourceTriageEntryId, not both',
      );
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      if (input.sourceTriageEntryId) {
        const triageEntry = await manager.getRepository(TriageEntry).findOne({ where: { id: input.sourceTriageEntryId } });
        if (!triageEntry) {
          throw new NotFoundException(`Triage entry ${input.sourceTriageEntryId} not found`);
        }
        if (!triageEntry.patientId) {
          throw new BadRequestException(
            `Triage entry ${input.sourceTriageEntryId} must be linked to a patient before it can be admitted`,
          );
        }
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: input.bedId } });
      if (!bed) {
        throw new NotFoundException(`Bed ${input.bedId} not found`);
      }
      if (bed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.bedId} is not available (status: ${bed.status})`);
      }

      bed.status = 'Occupied';
      await bedRepository.save(bed);

      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.save(
        admissionRepository.create({
          patientId: input.patientId,
          admissionSource: input.admissionSource,
          sourceAppointmentId: input.sourceAppointmentId ?? null,
          sourceTriageEntryId: input.sourceTriageEntryId ?? null,
          admittingDoctorId: input.admittingDoctorId,
          wardId: bed.wardId,
          bedId: bed.id,
          status: 'Admitted',
        }),
      );

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId: null,
          toBedId: bed.id,
          transferredBy: input.admittingDoctorId,
          reason: 'Initial admission',
        }),
      );

      return admission;
    });
  }

  async findOne(id: string): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admission = await manager.getRepository(Admission).findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      return admission;
    });
  }

  async listActive(wardId?: string): Promise<Admission[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Admission).find({
        where: wardId ? { status: 'Admitted', wardId } : { status: 'Admitted' },
        order: { admissionDate: 'DESC' },
      }),
    );
  }

  async transfer(id: string, input: TransferAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const toBed = await bedRepository.findOne({ where: { id: input.toBedId } });
      if (!toBed) {
        throw new NotFoundException(`Bed ${input.toBedId} not found`);
      }
      if (toBed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.toBedId} is not available (status: ${toBed.status})`);
      }

      const fromBedId = admission.bedId;
      const fromBed = await bedRepository.findOne({ where: { id: fromBedId } });
      if (fromBed) {
        fromBed.status = 'Available';
        await bedRepository.save(fromBed);
      }

      toBed.status = 'Occupied';
      await bedRepository.save(toBed);

      admission.wardId = toBed.wardId;
      admission.bedId = toBed.id;
      const updated = await admissionRepository.save(admission);

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId,
          toBedId: toBed.id,
          transferredBy: input.transferredBy,
          reason: input.reason ?? null,
        }),
      );

      return updated;
    });
  }

  async discharge(id: string, input: DischargeAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: admission.bedId } });
      if (bed) {
        bed.status = 'Available';
        await bedRepository.save(bed);
      }

      admission.status = 'Discharged';
      admission.dischargeDate = new Date();
      admission.dischargeType = input.dischargeType ?? null;
      admission.dischargeCondition = input.dischargeCondition ?? null;
      admission.dischargeSummary = input.dischargeSummary ?? null;
      admission.dischargedBy = input.dischargedBy;

      return admissionRepository.save(admission);
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=admissions.service`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/admissions/admissions.service.ts new/code/apps/api/src/admissions/admissions.service.integration-spec.ts
git commit -m "feat: add AdmissionsService"
```

---

### Task 6: `AdmissionsController`, `AdmissionsModule`, wiring into `AppModule`

**Files:**
- Create: `apps/api/src/admissions/dto/create-admission.dto.ts`
- Create: `apps/api/src/admissions/dto/transfer-admission.dto.ts`
- Create: `apps/api/src/admissions/dto/discharge-admission.dto.ts`
- Create: `apps/api/src/admissions/admissions.controller.ts`
- Create: `apps/api/src/admissions/admissions.controller.integration-spec.ts`
- Create: `apps/api/src/admissions/admissions.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `AdmissionsService` (Task 5), `PermissionGuard`/`RequirePermission` from `@hospital/auth-guards`, `admission.manage`/`admission.read` permissions (Task 3).
- Produces: `POST /admissions`, `GET /admissions`, `GET /admissions/:id`, `PATCH /admissions/:id/transfer`, `PATCH /admissions/:id/discharge`.

- [ ] **Step 1: Create the DTOs**

```typescript
// apps/api/src/admissions/dto/create-admission.dto.ts
export class CreateAdmissionDto {
  patientId!: string;
  admissionSource!: string;
  sourceAppointmentId?: string;
  sourceTriageEntryId?: string;
  admittingDoctorId!: string;
  bedId!: string;
}
```

```typescript
// apps/api/src/admissions/dto/transfer-admission.dto.ts
export class TransferAdmissionDto {
  toBedId!: string;
  transferredBy!: string;
  reason?: string;
}
```

```typescript
// apps/api/src/admissions/dto/discharge-admission.dto.ts
export class DischargeAdmissionDto {
  dischargedBy!: string;
  dischargeType?: string;
  dischargeCondition?: string;
  dischargeSummary?: string;
}
```

- [ ] **Step 2: Write the failing controller test**

Create `apps/api/src/admissions/admissions.controller.integration-spec.ts` (mirrors `VitalsController`'s/`TriageController`'s e2e permission-gating smoke tests — see `apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts` for the exact pattern this follows):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../app/app.module.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { dataSource as globalDataSource } from '../database/data-source.js';

describe('AdmissionsController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountsService: AccountsService;
  const TEST_TENANT_ID = 'test_admissions_e2e';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = globalDataSource;
    accountsService = moduleFixture.get(AccountsService);

    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await accountsService.provisionTenantSchema(dataSource, TEST_TENANT_ID);
  });

  afterAll(async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`DROP SCHEMA IF EXISTS "tenant_${TEST_TENANT_ID}" CASCADE`);
    } finally {
      await queryRunner.release();
    }
    await app.close();
  });

  it('fails with 403 when admitting without proper permissions', async () => {
    const res = await request(app.getHttpServer())
      .post('/admissions')
      .send({
        patientId: '00000000-0000-0000-0000-000000000000',
        admissionSource: 'Direct',
        admittingDoctorId: '00000000-0000-0000-0000-000000000000',
        bedId: '00000000-0000-0000-0000-000000000000',
      });

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 403 when listing admissions', async () => {
    const res = await request(app.getHttpServer()).get('/admissions');

    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=admissions.controller`
Expected: FAIL — `Cannot find module './admissions.controller.js'`.

- [ ] **Step 4: Implement `AdmissionsController`**

```typescript
// apps/api/src/admissions/admissions.controller.ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { AdmissionsService } from './admissions.service.js';
import { CreateAdmissionDto } from './dto/create-admission.dto.js';
import { TransferAdmissionDto } from './dto/transfer-admission.dto.js';
import { DischargeAdmissionDto } from './dto/discharge-admission.dto.js';

@Controller('admissions')
@UseGuards(PermissionGuard)
export class AdmissionsController {
  constructor(private readonly admissionsService: AdmissionsService) {}

  @Post()
  @RequirePermission('admission.manage')
  async admit(@Body() dto: CreateAdmissionDto) {
    return this.admissionsService.admit(dto);
  }

  @Get()
  @RequirePermission('admission.read')
  async list(@Query('wardId') wardId?: string) {
    return this.admissionsService.listActive(wardId);
  }

  @Get(':id')
  @RequirePermission('admission.read')
  async findOne(@Param('id') id: string) {
    return this.admissionsService.findOne(id);
  }

  @Patch(':id/transfer')
  @RequirePermission('admission.manage')
  async transfer(@Param('id') id: string, @Body() dto: TransferAdmissionDto) {
    return this.admissionsService.transfer(id, dto);
  }

  @Patch(':id/discharge')
  @RequirePermission('admission.manage')
  async discharge(@Param('id') id: string, @Body() dto: DischargeAdmissionDto) {
    return this.admissionsService.discharge(id, dto);
  }
}
```

- [ ] **Step 5: Create `AdmissionsModule`**

```typescript
// apps/api/src/admissions/admissions.module.ts
import { Module } from '@nestjs/common';
import { AdmissionsService } from './admissions.service.js';
import { AdmissionsController } from './admissions.controller.js';

@Module({
  controllers: [AdmissionsController],
  providers: [AdmissionsService],
  exports: [AdmissionsService],
})
export class AdmissionsModule {}
```

- [ ] **Step 6: Wire `AdmissionsModule` into `AppModule`**

In `apps/api/src/app/app.module.ts`, add the import:

```typescript
import { AdmissionsModule } from '../admissions/admissions.module.js';
```

Change the `@Module` `imports` array from:

```typescript
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule],
```

to:

```typescript
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule],
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=admissions.controller`
Expected: PASS — both tests.

- [ ] **Step 8: Run the full suite**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache
```

Expected: all test suites pass, 0 typecheck errors.

- [ ] **Step 9: Commit**

```bash
git add new/code/apps/api/src/admissions/dto new/code/apps/api/src/admissions/admissions.controller.ts new/code/apps/api/src/admissions/admissions.controller.integration-spec.ts new/code/apps/api/src/admissions/admissions.module.ts new/code/apps/api/src/app/app.module.ts
git commit -m "feat: add AdmissionsController and wire AdmissionsModule into AppModule"
```
