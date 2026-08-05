# Lab/LIS Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Lab/LIS module's core clinical pipeline — test catalog (Category→Test→Component), requisition/sample tracking linked to the existing Order module, per-component result entry, and single-level verification.

**Architecture:** New domain module `apps/api/src/lab/` with two services/controllers split by concern: `LabCatalogService`/`LabCatalogController` (catalog CRUD, mirrors `MasterDataService`'s pattern) and `LabWorkflowService`/`LabWorkflowController` (requisition/sample/result/verify actions, mirrors `AdmissionsService`'s status-guarded-transition pattern). All tenant-scoped via `TenantConnectionService.runInTenantSchema()`.

**Tech Stack:** NestJS, TypeORM (raw-SQL migrations), Nx — no new external dependencies.

## Global Constraints

- Entities live at `apps/api/src/lab/entities/*.entity.ts`: `LabTestCategory`, `LabTest`, `LabTestComponent`, `LabRequisition`, `LabResult` — exact fields as specified in Task 1.
- `LabRequisition.status` values: `'Pending'` → `'SampleCollected'` → `'ResultsEntered'` → `'Verified'`, plus `'Cancelled'` (from any non-terminal state, not from `'Verified'`).
- `LabResult` upsert semantics: re-entering a result for a component that already has one overwrites it, as long as the requisition isn't `'Verified'`; once `'Verified'`, `enterResult` throws `ConflictException`.
- RBAC permissions (exact names, nested-dot style matching `identity.accounts.manage`/`system-admin.tenants.manage`, not underscores): `lab.catalog.manage` (Hospital Admin, Super Admin), `lab.read` (Lab Technician, Doctor), `lab.requisition.create` (Lab Technician), `lab.result.enter` (Lab Technician), `lab.result.verify` (Lab Technician).
- No FK-level TypeORM relations anywhere (`@ManyToOne` etc.) — bare `uuid` columns only, matching every existing entity in this codebase (isolation is schema-per-tenant, not entity-level).
- No `tenantId` column on any entity — tenancy is enforced by Postgres schema/search_path via `TenantConnectionService`.
- Every relative import needs an explicit `.js` extension (`nodenext` module resolution).
- No class-validator decorators on DTOs — this codebase's existing DTOs are plain classes with `!`/`?` typing only (see `CreateAdmissionDto`, `CreateDepartmentDto`).
- No automated tests this session (standing project instruction) — manual verification only, per each task's steps.
- Never `git commit --amend`; new commit per task; no AI co-authorship trailer; conventional commit prefixes.
- Migration file: `0018-create-lab-tables.ts`, class `CreateLabTables0018`, `name = 'CreateLabTables00182000000000015'` (following the established `<ClassName><paddedFileNum>2000000000<sequentialOrder>` pattern — 0017/reporting was `...014`, this is the next tenant-migration slot, `...015`).

---

### Task 1: Migration — 5 Lab tables + requisition-number sequence table

**Files:**
- Create: `apps/api/src/database/migrations/0018-create-lab-tables.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: tables `lab_test_categories`, `lab_tests`, `lab_test_components`, `lab_requisitions`, `lab_results`, `lab_requisition_sequences` — exact columns below, consumed by Task 2's entities.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/database/migrations/0018-create-lab-tables.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLabTables0018 implements MigrationInterface {
  name = 'CreateLabTables00182000000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lab_test_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE lab_tests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "categoryId" uuid NOT NULL,
        name varchar NOT NULL,
        code varchar NOT NULL,
        "specimenType" varchar NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_lab_tests_category_id" ON lab_tests ("categoryId")`);
    await queryRunner.query(`
      CREATE TABLE lab_test_components (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "testId" uuid NOT NULL,
        name varchar NOT NULL,
        unit varchar NULL,
        "referenceRangeLow" numeric NULL,
        "referenceRangeHigh" numeric NULL,
        "referenceRangeText" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_test_components_test_id" ON lab_test_components ("testId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "testId" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        "specimenType" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "sampleCollectedBy" uuid NULL,
        "sampleCollectedAt" timestamptz NULL,
        "verifiedBy" uuid NULL,
        "verifiedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lab_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_requisitions_order_item_id" ON lab_requisitions ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_results (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requisitionId" uuid NOT NULL,
        "componentId" uuid NOT NULL,
        value varchar NOT NULL,
        "isAbnormal" boolean NOT NULL DEFAULT false,
        "enteredBy" uuid NOT NULL,
        "enteredAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lab_results_requisition_component" UNIQUE ("requisitionId", "componentId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_lab_results_requisition_id" ON lab_results ("requisitionId")`,
    );
    await queryRunner.query(`
      CREATE TABLE lab_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE lab_requisition_sequences`);
    await queryRunner.query(`DROP TABLE lab_results`);
    await queryRunner.query(`DROP TABLE lab_requisitions`);
    await queryRunner.query(`DROP TABLE lab_test_components`);
    await queryRunner.query(`DROP TABLE lab_tests`);
    await queryRunner.query(`DROP TABLE lab_test_categories`);
  }
}
```

Note: `lab_results` has a `UNIQUE ("requisitionId", "componentId")` constraint — this is what makes
Task 5's "re-entering a result overwrites the existing row" behavior implementable as a single
`ON CONFLICT` upsert rather than a manual find-then-update-or-insert.

- [ ] **Step 2: Register the migration**

Current relevant lines in `apps/api/src/database/migrations/index.ts`:

```ts
import { CreateReportingTables0017 } from './0017-create-reporting-tables.js';

// ... (PLATFORM_MIGRATIONS unchanged) ...

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

Add the import and append `CreateLabTables0018` to the end of the `TENANT_MIGRATIONS` array (it
depends on nothing else added this task, but logically follows Orders since it references
`orderItemId`):

```ts
import { CreateReportingTables0017 } from './0017-create-reporting-tables.js';
import { CreateLabTables0018 } from './0018-create-lab-tables.js';

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
  CreateLabTables0018,
];
```

- [ ] **Step 3: Write the 5 entity files**

Create `apps/api/src/lab/entities/lab-test-category.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('lab_test_categories')
export class LabTestCategory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/lab/entities/lab-test.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('lab_tests')
export class LabTest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  categoryId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  code!: string;

  @Column({ type: 'varchar' })
  specimenType!: string; // e.g. 'Blood', 'Urine'

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/lab/entities/lab-test-component.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('lab_test_components')
export class LabTestComponent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  unit!: string | null;

  @Column({ type: 'numeric', nullable: true })
  referenceRangeLow!: string | null;

  @Column({ type: 'numeric', nullable: true })
  referenceRangeHigh!: string | null;

  @Column({ type: 'varchar', nullable: true })
  referenceRangeText!: string | null; // e.g. 'Negative'

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/lab/entities/lab-requisition.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('lab_requisitions')
export class LabRequisition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderItemId!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @Column({ type: 'varchar', unique: true })
  requisitionNumber!: string;

  @Column({ type: 'varchar' })
  specimenType!: string;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'SampleCollected' | 'ResultsEntered' | 'Verified' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  sampleCollectedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sampleCollectedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  verifiedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  cancelReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/lab/entities/lab-result.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lab_results')
export class LabResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  requisitionId!: string;

  @Column({ type: 'uuid' })
  componentId!: string;

  @Column({ type: 'varchar' })
  value!: string; // numeric or qualitative ('Positive'/'Negative')

  @Column({ type: 'boolean', default: false })
  isAbnormal!: boolean;

  @Column({ type: 'uuid' })
  enteredBy!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  enteredAt!: Date;
}
```

- [ ] **Step 4: Register the 5 new entities in `data-source.ts`**

Every entity a repository is fetched for via `manager.getRepository(X)` (through
`TenantConnectionService.runInTenantSchema()`) must be registered in the main `DataSource`'s
`entities` array in `apps/api/src/database/data-source.ts` — this is a separate, load-bearing
requirement from the migration itself (the migration creates the tables; this registration is
what lets TypeORM resolve entity metadata for them at all — omitting it fails at runtime with
"No metadata for LabTestCategory was found", not at compile time). Current relevant lines:

```ts
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { PLATFORM_MIGRATIONS } from './migrations/index.js';
```
```ts
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer, Order, OrderItem, BillingSettings, BillingSequence, Invoice, InvoiceItem, Payment, Deposit, ReportingEvent],
```

Add the 5 imports and append the 5 entity classes to the array (after `ReportingEvent`, matching
the file's existing append-at-the-end convention):

```ts
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { LabTestCategory } from '../lab/entities/lab-test-category.entity.js';
import { LabTest } from '../lab/entities/lab-test.entity.js';
import { LabTestComponent } from '../lab/entities/lab-test-component.entity.js';
import { LabRequisition } from '../lab/entities/lab-requisition.entity.js';
import { LabResult } from '../lab/entities/lab-result.entity.js';
import { PLATFORM_MIGRATIONS } from './migrations/index.js';
```
```ts
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer, Order, OrderItem, BillingSettings, BillingSequence, Invoice, InvoiceItem, Payment, Deposit, ReportingEvent, LabTestCategory, LabTest, LabTestComponent, LabRequisition, LabResult],
```

Note: `lab_requisition_sequences` deliberately has **no** corresponding TypeORM entity class — it
is accessed only via raw `manager.query()` SQL in Task 3's generator service, the same way
`patient_sequences` has no entity class and `PatientNumberGeneratorService` queries it raw. Only
the 5 real entities need registering here.

- [ ] **Step 5: Verify the migration runs**

Run (from `apps/api`, following `Runbook.md`'s documented tenant-migration path via Jest — direct
`tsx`/`ts-node` invocation is a known-broken tooling gap tracked separately in `pending-tasks.md`,
not something to work around here): create a throwaway tenant via the existing
`TenantProvisioningService` path (same approach used in prior items' manual verification — see
`new/docs/superpowers/plans/2026-08-05-reporting-dashboard-read-apis.md`'s Task 3 verification
steps for the exact pattern), and confirm all 6 tables exist in that tenant's schema via a direct
`psql \dt tenant_<id>.*` check.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/migrations/0018-create-lab-tables.ts apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts apps/api/src/lab/entities/
git commit -m "feat(lab): add Lab/LIS core tables and entities"
```

---

### Task 2: RBAC — Lab permissions and role mappings

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Consumes: `Lab Technician` role (already exists in `ROLE_CATALOG`, zero permissions today).
- Produces: 5 permissions (`lab.catalog.manage`, `lab.read`, `lab.requisition.create`,
  `lab.result.enter`, `lab.result.verify`) consumed by Task 4/5's `@RequirePermission()` decorators.

- [ ] **Step 1: Add the 5 permissions**

In `PERMISSION_CATALOG` (append after the `reporting.read` entry, before the closing `];`):

```ts
  {
    name: 'lab.catalog.manage',
    description: 'Create, list, and update the lab test category/test/component catalog.',
  },
  {
    name: 'lab.read',
    description: 'View the lab catalog, requisitions, and results.',
  },
  {
    name: 'lab.requisition.create',
    description: 'Create a lab requisition from an order item.',
  },
  {
    name: 'lab.result.enter',
    description: 'Mark sample collection and enter lab result values.',
  },
  {
    name: 'lab.result.verify',
    description: 'Verify a fully-resulted lab requisition.',
  },
```

- [ ] **Step 2: Add role mappings**

In `ROLE_PERMISSION_MAPPINGS` (append after the `reporting.read` block, before the closing `];`):

```ts
  { roleName: 'Super Admin', permissionName: 'lab.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'lab.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'lab.read' },
  { roleName: 'Hospital Admin', permissionName: 'lab.read' },
  { roleName: 'Lab Technician', permissionName: 'lab.read' },
  { roleName: 'Doctor', permissionName: 'lab.read' },
  { roleName: 'Super Admin', permissionName: 'lab.requisition.create' },
  { roleName: 'Lab Technician', permissionName: 'lab.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'lab.result.enter' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.enter' },
  { roleName: 'Super Admin', permissionName: 'lab.result.verify' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.verify' },
```

(Super Admin gets every permission explicitly here for consistency with how every other domain's
mappings in this file already list Super Admin alongside Hospital Admin/the operational role —
even though `Super Admin.bypassesPermissionChecks === true` makes the explicit grant redundant at
runtime, matching the existing file's own convention rather than treating this domain
differently.)

- [ ] **Step 3: Verify the seed runs cleanly**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog` (from `new/code`) — this is the
existing test that exercises `seedRbacCatalog()` end-to-end against a real test database;
confirm it still passes with the 5 new permissions and 12 new mappings inserted without
constraint violations.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add lab permissions, wire Lab Technician's first grants"
```

---

### Task 3: `LabRequisitionNumberGeneratorService`

**Files:**
- Create: `apps/api/src/lab/lab-requisition-number-generator.service.ts`

**Interfaces:**
- Consumes: `TenantConnectionService.runInTenantSchema()` (existing).
- Produces: `LabRequisitionNumberGeneratorService.generateNextRequisitionNumber(prefix = 'LAB'): Promise<string>`, consumed by Task 5's `createRequisition`.

- [ ] **Step 1: Write the service**

Create `apps/api/src/lab/lab-requisition-number-generator.service.ts` — copies
`PatientNumberGeneratorService`'s atomic-sequence pattern verbatim against the new
`lab_requisition_sequences` table from Task 1:

```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class LabRequisitionNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextRequisitionNumber(prefix = 'LAB'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO lab_requisition_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = lab_requisition_sequences."lastSequence" + 1
        RETURNING "lastSequence"
        `,
        [prefix, currentYear],
      );

      const nextSeq = result[0].lastSequence as number;
      const paddedSeq = String(nextSeq).padStart(5, '0');
      return `${prefix}-${currentYear}-${paddedSeq}`;
    });
  }
}
```

- [ ] **Step 2: Verify via a scratch script**

Write a scratch script (do not commit) that constructs the service against a live tenant schema
(same `tsx`-from-`apps/api` approach used in this session's prior manual verifications) and calls
`generateNextRequisitionNumber()` twice in a row — confirm the two returned values are sequential
(e.g. `LAB-2026-00001`, `LAB-2026-00002`), then delete the scratch script.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lab/lab-requisition-number-generator.service.ts
git commit -m "feat(lab): add atomic requisition-number generator"
```

---

### Task 4: `LabCatalogService` + `LabCatalogController` + DTOs

**Files:**
- Create: `apps/api/src/lab/lab-catalog.service.ts`
- Create: `apps/api/src/lab/lab-catalog.controller.ts`
- Create: `apps/api/src/lab/dto/create-lab-test-category.dto.ts`
- Create: `apps/api/src/lab/dto/create-lab-test.dto.ts`
- Create: `apps/api/src/lab/dto/create-lab-test-component.dto.ts`

**Interfaces:**
- Consumes: `LabTestCategory`, `LabTest`, `LabTestComponent` entities (Task 1);
  `TenantConnectionService` (existing).
- Produces: `LabCatalogService` with `createCategory`, `listCategories`, `createTest`,
  `listTestsByCategory`, `getTest`, `createComponent`, `listComponentsByTest` — consumed by
  Task 5's `createRequisition` (needs `getTest`) and `enterResult` (needs
  `listComponentsByTest`).

- [ ] **Step 1: Write the DTOs**

Create `apps/api/src/lab/dto/create-lab-test-category.dto.ts`:

```ts
export class CreateLabTestCategoryDto {
  name!: string;
  displaySequence?: number;
}
```

Create `apps/api/src/lab/dto/create-lab-test.dto.ts`:

```ts
export class CreateLabTestDto {
  categoryId!: string;
  name!: string;
  code!: string;
  specimenType!: string;
}
```

Create `apps/api/src/lab/dto/create-lab-test-component.dto.ts`:

```ts
export class CreateLabTestComponentDto {
  name!: string;
  unit?: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  referenceRangeText?: string;
  displaySequence?: number;
}
```

- [ ] **Step 2: Write `LabCatalogService`**

Create `apps/api/src/lab/lab-catalog.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { LabTestCategory } from './entities/lab-test-category.entity.js';
import { LabTest } from './entities/lab-test.entity.js';
import { LabTestComponent } from './entities/lab-test-component.entity.js';

export interface CreateLabTestCategoryInput {
  name: string;
  displaySequence?: number;
}

export interface CreateLabTestInput {
  categoryId: string;
  name: string;
  code: string;
  specimenType: string;
}

export interface CreateLabTestComponentInput {
  name: string;
  unit?: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  referenceRangeText?: string;
  displaySequence?: number;
}

@Injectable()
export class LabCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createCategory(input: CreateLabTestCategoryInput): Promise<LabTestCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTestCategory);
      return repository.save(
        repository.create({
          name: input.name,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listCategories(): Promise<LabTestCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LabTestCategory).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async createTest(input: CreateLabTestInput): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const category = await manager
        .getRepository(LabTestCategory)
        .findOne({ where: { id: input.categoryId } });
      if (!category) {
        throw new NotFoundException(`Lab test category ${input.categoryId} not found`);
      }

      const repository = manager.getRepository(LabTest);
      return repository.save(
        repository.create({
          categoryId: input.categoryId,
          name: input.name,
          code: input.code,
          specimenType: input.specimenType,
        }),
      );
    });
  }

  async listTestsByCategory(categoryId: string): Promise<LabTest[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LabTest).find({ where: { categoryId }, order: { name: 'ASC' } }),
    );
  }

  async getTest(id: string): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const test = await manager.getRepository(LabTest).findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      return test;
    });
  }

  async createComponent(testId: string, input: CreateLabTestComponentInput): Promise<LabTestComponent> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const test = await manager.getRepository(LabTest).findOne({ where: { id: testId } });
      if (!test) {
        throw new NotFoundException(`Lab test ${testId} not found`);
      }

      const repository = manager.getRepository(LabTestComponent);
      return repository.save(
        repository.create({
          testId,
          name: input.name,
          unit: input.unit ?? null,
          referenceRangeLow: input.referenceRangeLow != null ? String(input.referenceRangeLow) : null,
          referenceRangeHigh: input.referenceRangeHigh != null ? String(input.referenceRangeHigh) : null,
          referenceRangeText: input.referenceRangeText ?? null,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listComponentsByTest(testId: string): Promise<LabTestComponent[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(LabTestComponent)
        .find({ where: { testId }, order: { displaySequence: 'ASC' } }),
    );
  }
}
```

Note: `referenceRangeLow`/`High` are stored as `numeric` in Postgres, which TypeORM maps to
`string` in JS (avoids float-precision issues) — the DTO/input types use `number` for API
ergonomics, converted to `string` at the service boundary, matching how `BillingSettings`/
`Invoice` entities in this codebase already handle `numeric` columns (see
`apps/api/src/billing/entities/numeric.transformer.ts` for the existing precedent, though this
task doesn't need a full transformer since only 2 columns are involved).

- [ ] **Step 3: Write `LabCatalogController`**

Create `apps/api/src/lab/lab-catalog.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { LabCatalogService } from './lab-catalog.service.js';
import { CreateLabTestCategoryDto } from './dto/create-lab-test-category.dto.js';
import { CreateLabTestDto } from './dto/create-lab-test.dto.js';
import { CreateLabTestComponentDto } from './dto/create-lab-test-component.dto.js';

@Controller('lab')
@UseGuards(PermissionGuard)
export class LabCatalogController {
  constructor(private readonly labCatalogService: LabCatalogService) {}

  @Post('categories')
  @RequirePermission('lab.catalog.manage')
  async createCategory(@Body() dto: CreateLabTestCategoryDto) {
    return this.labCatalogService.createCategory(dto);
  }

  @Get('categories')
  @RequirePermission('lab.read')
  async listCategories() {
    return this.labCatalogService.listCategories();
  }

  @Post('tests')
  @RequirePermission('lab.catalog.manage')
  async createTest(@Body() dto: CreateLabTestDto) {
    return this.labCatalogService.createTest(dto);
  }

  @Get('categories/:categoryId/tests')
  @RequirePermission('lab.read')
  async listTestsByCategory(@Param('categoryId') categoryId: string) {
    return this.labCatalogService.listTestsByCategory(categoryId);
  }

  @Get('tests/:id')
  @RequirePermission('lab.read')
  async getTest(@Param('id') id: string) {
    return this.labCatalogService.getTest(id);
  }

  @Post('tests/:testId/components')
  @RequirePermission('lab.catalog.manage')
  async createComponent(@Param('testId') testId: string, @Body() dto: CreateLabTestComponentDto) {
    return this.labCatalogService.createComponent(testId, dto);
  }

  @Get('tests/:testId/components')
  @RequirePermission('lab.read')
  async listComponentsByTest(@Param('testId') testId: string) {
    return this.labCatalogService.listComponentsByTest(testId);
  }
}
```

- [ ] **Step 4: Verify via a scratch script**

Write a scratch script (do not commit) that, against a live tenant schema, creates a category,
creates a test under it, creates two components under that test, then lists each level back and
confirms the returned data matches what was created. Delete the scratch script afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lab/lab-catalog.service.ts apps/api/src/lab/lab-catalog.controller.ts apps/api/src/lab/dto/create-lab-test-category.dto.ts apps/api/src/lab/dto/create-lab-test.dto.ts apps/api/src/lab/dto/create-lab-test-component.dto.ts
git commit -m "feat(lab): add lab catalog service and controller"
```

---

### Task 5: `LabWorkflowService` + `LabWorkflowController` + module wiring + full pipeline verification

**Files:**
- Create: `apps/api/src/lab/lab-workflow.service.ts`
- Create: `apps/api/src/lab/lab-workflow.controller.ts`
- Create: `apps/api/src/lab/dto/create-requisition.dto.ts`
- Create: `apps/api/src/lab/dto/collect-sample.dto.ts`
- Create: `apps/api/src/lab/dto/enter-result.dto.ts`
- Create: `apps/api/src/lab/dto/verify-requisition.dto.ts`
- Create: `apps/api/src/lab/dto/cancel-requisition.dto.ts`
- Create: `apps/api/src/lab/lab.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `LabRequisition`, `LabResult` entities (Task 1); `LabRequisitionNumberGeneratorService`
  (Task 3); `LabCatalogService.getTest`/`listComponentsByTest` (Task 4); `OrderItem` entity
  (existing, `apps/api/src/orders/entities/order-item.entity.ts`).
- Produces: `LabWorkflowService` with `createRequisition`, `collectSample`, `enterResult`,
  `verify`, `cancel`, `findOne`, `listByOrderItem` — this is the plan's terminal task, nothing
  later consumes these.

- [ ] **Step 1: Write the DTOs**

Create `apps/api/src/lab/dto/create-requisition.dto.ts`:

```ts
export class CreateRequisitionDto {
  orderItemId!: string;
  testId!: string;
  specimenType!: string;
}
```

Create `apps/api/src/lab/dto/collect-sample.dto.ts`:

```ts
export class CollectSampleDto {
  sampleCollectedBy!: string;
}
```

Create `apps/api/src/lab/dto/enter-result.dto.ts`:

```ts
export class EnterResultDto {
  componentId!: string;
  value!: string;
  isAbnormal?: boolean;
  enteredBy!: string;
}
```

Create `apps/api/src/lab/dto/verify-requisition.dto.ts`:

```ts
export class VerifyRequisitionDto {
  verifiedBy!: string;
}
```

Create `apps/api/src/lab/dto/cancel-requisition.dto.ts`:

```ts
export class CancelRequisitionDto {
  cancelReason?: string;
}
```

- [ ] **Step 2: Write `LabWorkflowService`**

Create `apps/api/src/lab/lab-workflow.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { LabRequisition } from './entities/lab-requisition.entity.js';
import { LabResult } from './entities/lab-result.entity.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';
import { LabCatalogService } from './lab-catalog.service.js';

export interface CreateRequisitionInput {
  orderItemId: string;
  testId: string;
  specimenType: string;
}

export interface EnterResultInput {
  componentId: string;
  value: string;
  isAbnormal?: boolean;
  enteredBy: string;
}

const NON_TERMINAL_STATUSES = ['Pending', 'SampleCollected', 'ResultsEntered'];

@Injectable()
export class LabWorkflowService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: LabRequisitionNumberGeneratorService,
    private readonly labCatalogService: LabCatalogService,
  ) {}

  async createRequisition(input: CreateRequisitionInput): Promise<LabRequisition> {
    await this.labCatalogService.getTest(input.testId); // throws NotFoundException if missing

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Lab') {
        throw new BadRequestException(`Order item ${input.orderItemId} is not a Lab order (itemType: ${orderItem.itemType})`);
      }

      const requisitionRepository = manager.getRepository(LabRequisition);
      const existing = await requisitionRepository.findOne({
        where: { orderItemId: input.orderItemId },
      });
      if (existing && existing.status !== 'Cancelled') {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled requisition (${existing.id})`,
        );
      }

      const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

      return requisitionRepository.save(
        requisitionRepository.create({
          orderItemId: input.orderItemId,
          testId: input.testId,
          requisitionNumber,
          specimenType: input.specimenType,
          status: 'Pending',
        }),
      );
    });
  }

  async findOne(id: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(LabRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      return requisition;
    });
  }

  async listByOrderItem(orderItemId: string): Promise<LabRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LabRequisition).find({ where: { orderItemId }, order: { createdAt: 'DESC' } }),
    );
  }

  async collectSample(id: string, collectedBy: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} must be Pending to collect a sample (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'SampleCollected';
      requisition.sampleCollectedBy = collectedBy;
      requisition.sampleCollectedAt = new Date();
      return repository.save(requisition);
    });
  }

  async enterResult(requisitionId: string, input: EnterResultInput): Promise<LabResult> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisitionRepository = manager.getRepository(LabRequisition);
      const requisition = await requisitionRepository.findOne({ where: { id: requisitionId } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${requisitionId} not found`);
      }
      if (requisition.status === 'Verified') {
        throw new ConflictException(`Requisition ${requisitionId} is already verified; results are locked`);
      }
      if (requisition.status === 'Cancelled') {
        throw new ConflictException(`Requisition ${requisitionId} is cancelled`);
      }
      if (requisition.status === 'Pending') {
        throw new ConflictException(
          `Requisition ${requisitionId} must have a sample collected before entering results`,
        );
      }

      const components = await this.labCatalogService.listComponentsByTest(requisition.testId);
      if (!components.some((c) => c.id === input.componentId)) {
        throw new BadRequestException(
          `Component ${input.componentId} does not belong to requisition ${requisitionId}'s test`,
        );
      }

      const result = await manager.query(
        `
        INSERT INTO lab_results ("requisitionId", "componentId", value, "isAbnormal", "enteredBy")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("requisitionId", "componentId")
        DO UPDATE SET value = $3, "isAbnormal" = $4, "enteredBy" = $5, "enteredAt" = now()
        RETURNING *
        `,
        [requisitionId, input.componentId, input.value, input.isAbnormal ?? false, input.enteredBy],
      );

      if (requisition.status !== 'ResultsEntered') {
        const enteredResults = await manager.getRepository(LabResult).find({ where: { requisitionId } });
        const allComponentsResulted = components.every((c) =>
          enteredResults.some((r) => r.componentId === c.id),
        );
        if (allComponentsResulted) {
          requisition.status = 'ResultsEntered';
          await requisitionRepository.save(requisition);
        }
      }

      return result[0] as LabResult;
    });
  }

  async verify(id: string, verifiedBy: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (requisition.status !== 'ResultsEntered') {
        throw new ConflictException(
          `Requisition ${id} must have all results entered before verification (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'Verified';
      requisition.verifiedBy = verifiedBy;
      requisition.verifiedAt = new Date();
      return repository.save(requisition);
    });
  }

  async cancel(id: string, cancelReason?: string): Promise<LabRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabRequisition);
      const requisition = await repository.findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Lab requisition ${id} not found`);
      }
      if (!NON_TERMINAL_STATUSES.includes(requisition.status)) {
        throw new ConflictException(
          `Requisition ${id} cannot be cancelled from status ${requisition.status}`,
        );
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }
}
```

- [ ] **Step 3: Write `LabWorkflowController`**

Create `apps/api/src/lab/lab-workflow.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { LabWorkflowService } from './lab-workflow.service.js';
import { CreateRequisitionDto } from './dto/create-requisition.dto.js';
import { CollectSampleDto } from './dto/collect-sample.dto.js';
import { EnterResultDto } from './dto/enter-result.dto.js';
import { VerifyRequisitionDto } from './dto/verify-requisition.dto.js';
import { CancelRequisitionDto } from './dto/cancel-requisition.dto.js';

@Controller('lab/requisitions')
@UseGuards(PermissionGuard)
export class LabWorkflowController {
  constructor(private readonly labWorkflowService: LabWorkflowService) {}

  @Post()
  @RequirePermission('lab.requisition.create')
  async create(@Body() dto: CreateRequisitionDto) {
    return this.labWorkflowService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('lab.read')
  async listByOrderItem(@Query('orderItemId') orderItemId: string) {
    return this.labWorkflowService.listByOrderItem(orderItemId);
  }

  @Get(':id')
  @RequirePermission('lab.read')
  async findOne(@Param('id') id: string) {
    return this.labWorkflowService.findOne(id);
  }

  @Patch(':id/collect-sample')
  @RequirePermission('lab.result.enter')
  async collectSample(@Param('id') id: string, @Body() dto: CollectSampleDto) {
    return this.labWorkflowService.collectSample(id, dto.sampleCollectedBy);
  }

  @Post(':id/results')
  @RequirePermission('lab.result.enter')
  async enterResult(@Param('id') id: string, @Body() dto: EnterResultDto) {
    return this.labWorkflowService.enterResult(id, dto);
  }

  @Patch(':id/verify')
  @RequirePermission('lab.result.verify')
  async verify(@Param('id') id: string, @Body() dto: VerifyRequisitionDto) {
    return this.labWorkflowService.verify(id, dto.verifiedBy);
  }

  @Patch(':id/cancel')
  @RequirePermission('lab.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelRequisitionDto) {
    return this.labWorkflowService.cancel(id, dto.cancelReason);
  }
}
```

- [ ] **Step 4: Write `LabModule` and wire it into `AppModule`**

Create `apps/api/src/lab/lab.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LabCatalogService } from './lab-catalog.service.js';
import { LabCatalogController } from './lab-catalog.controller.js';
import { LabWorkflowService } from './lab-workflow.service.js';
import { LabWorkflowController } from './lab-workflow.controller.js';
import { LabRequisitionNumberGeneratorService } from './lab-requisition-number-generator.service.js';

@Module({
  controllers: [LabCatalogController, LabWorkflowController],
  providers: [LabCatalogService, LabWorkflowService, LabRequisitionNumberGeneratorService],
  exports: [LabCatalogService, LabWorkflowService],
})
export class LabModule {}
```

Current relevant lines in `apps/api/src/app/app.module.ts`:

```ts
import { ReportingModule } from '../reporting/reporting.module.js';
```
```ts
    BillingModule,
    ReportingModule,
  ],
```

Add the import and add `LabModule` to the `imports` array (after `ReportingModule`, matching the
file's existing append-at-the-end convention):

```ts
import { ReportingModule } from '../reporting/reporting.module.js';
import { LabModule } from '../lab/lab.module.js';
```
```ts
    BillingModule,
    ReportingModule,
    LabModule,
  ],
```

- [ ] **Step 5: Full pipeline manual verification**

Write a scratch script (do not commit) that, against a live tenant schema:
1. Creates a category, a test, and 2 components under it (via `LabCatalogService`, from Task 4).
2. Creates an `Order` + `OrderItem` (`itemType: 'Lab'`) via the existing Orders module.
3. Calls `createRequisition` — confirm status `'Pending'` and a `requisitionNumber` like
   `LAB-2026-NNNNN`.
4. Calls `collectSample` — confirm status `'SampleCollected'`.
5. Calls `enterResult` for only the first of the 2 components — confirm status is still
   `'SampleCollected'` (not yet `'ResultsEntered'`, since one component is still missing).
6. Calls `enterResult` for the second component — confirm status auto-advances to
   `'ResultsEntered'`.
7. Calls `enterResult` again for the first component with a different value — confirm the
   `LabResult` row's `value` is overwritten (upsert), not duplicated (query `lab_results` directly
   and confirm exactly 2 rows for this requisition, not 3).
8. Calls `verify` — confirm status `'Verified'`, `verifiedBy`/`verifiedAt` set.
9. Calls `enterResult` again post-verification — confirm it throws `ConflictException`.
10. Attempts `cancel` on the now-`'Verified'` requisition — confirm it throws `ConflictException`.
11. Separately, creates a second requisition, cancels it while still `'Pending'` — confirm status
    `'Cancelled'` and `cancelReason` stored.

Delete the scratch script afterward, and drop the throwaway tenant per this session's established
pattern (ask for confirmation before the destructive DB operations, per standing practice).

- [ ] **Step 6: Confirm the rest of the suite is unaffected**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`) — confirm the only failure is the
pre-existing, already-tracked `persisting-reporting-event-publisher.integration-spec.ts` one (not
a new one), same baseline as every prior item this session.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lab/lab-workflow.service.ts apps/api/src/lab/lab-workflow.controller.ts apps/api/src/lab/dto/create-requisition.dto.ts apps/api/src/lab/dto/collect-sample.dto.ts apps/api/src/lab/dto/enter-result.dto.ts apps/api/src/lab/dto/verify-requisition.dto.ts apps/api/src/lab/dto/cancel-requisition.dto.ts apps/api/src/lab/lab.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(lab): add lab workflow service, controller, and module wiring"
```

---

### Task 6: Documentation — Development-Standards, pending-tasks

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing (terminal task).

- [ ] **Step 1: Add a new section to `Development-Standards.md`**

The file currently ends (last lines) with:

```
See `new/docs/superpowers/plans/2026-08-05-minio-object-storage.md` for the full implementation
history.
```

Append after that:

```markdown

## 14. Lab/LIS Core Pipeline

The Lab/LIS module (`apps/api/src/lab/`) splits into two controllers/services by concern:
`LabCatalogService`/`LabCatalogController` (category/test/component catalog CRUD, gated by
`lab.catalog.manage` — Hospital Admin/Super Admin only, mirrors `master-data.manage`'s
admin-only-catalog convention) and `LabWorkflowService`/`LabWorkflowController` (requisition/
sample/result/verify actions, gated by `lab.requisition.create`/`lab.result.enter`/
`lab.result.verify` — Lab Technician's first-ever permission grants).

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
```

- [ ] **Step 2: Update `pending-tasks.md`**

The Phase 6 product backlog currently reads (lines 104-114):

```
## Phase 6 — Product module backlog

Follow the PRD's own phase ordering as-is:

- Phase 2: Lab/LIS, Radiology, DICOM, Pharmacy, Inventory, Ward Supply
- Phase 3: Insurance/Claims, Accounting, Verification, Fixed Asset
- Phase 4: Clinical/EMR long tail, Nursing, Emergency, OT, Maternity, CSSD
- Phase 5: Employee, Payroll, Fraction and Incentive
- Phase 6: Helpdesk, Marketing and Referral, Social Service Unit, Notification, Document and
  Print, full Reporting/Dashboard
```

Replace the `Phase 2` bullet with a checked-off sub-item for Lab/LIS, keeping the rest of that
bullet's still-pending domains listed plainly (matching how other items in this file distinguish
done-vs-not-done within one line):

```
- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. **Not done:** report/PDF export, machine/instrument
        (LIS) integration, external lab send-out, government disease-reporting mapping,
        multi-level verification — each a distinct future item.
  - Radiology, DICOM, Pharmacy, Inventory, Ward Supply — not started
- Phase 3: Insurance/Claims, Accounting, Verification, Fixed Asset
- Phase 4: Clinical/EMR long tail, Nursing, Emergency, OT, Maternity, CSSD
- Phase 5: Employee, Payroll, Fraction and Incentive
- Phase 6: Helpdesk, Marketing and Referral, Social Service Unit, Notification, Document and
  Print, full Reporting/Dashboard
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document Lab/LIS core pipeline, update Phase 6 backlog status"
```
