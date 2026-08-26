# Radiology Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Radiology module's core clinical pipeline — imaging catalog (Type→Item), requisition/scan tracking linked to the existing Order module, single-field narrative report entry, and single-level verification.

**Architecture:** New domain module `apps/api/src/radiology/` with two services/controllers split by concern, mirroring `apps/api/src/lab/`'s shape exactly: `RadiologyCatalogService`/`RadiologyCatalogController` (catalog CRUD) and `RadiologyWorkflowService`/`RadiologyWorkflowController` (requisition/scan/report/verify actions). All tenant-scoped via `TenantConnectionService.runInTenantSchema()`.

**Tech Stack:** NestJS, TypeORM (raw-SQL migrations), Nx — no new external dependencies.

## Global Constraints

- Entities live at `apps/api/src/radiology/entities/*.entity.ts`: `RadiologyImagingType`, `RadiologyImagingItem`, `RadiologyRequisition` — exact fields as specified in Task 1. **Unlike Lab, there is no separate report/result entity** — report fields live directly on `RadiologyRequisition` (one narrative report per requisition, not N per-component results).
- `RadiologyRequisition.status` values: `'Pending'` → `'Scanned'` → `'ReportEntered'` → `'Verified'`, plus `'Cancelled'` (from any non-terminal state, not from `'Verified'`).
- **Correctness fixes applied from the start** (Lab/LIS's final review found these missing and had to fix them after the fact — this plan bakes them in immediately, not as a follow-up):
  - The existing-requisition check in `createRequisition` filters `status: Not('Cancelled')` (TypeORM `Not` operator), not just `orderItemId`.
  - The initial migration (Task 1) includes a partial unique index (`CREATE UNIQUE INDEX ... ON radiology_requisitions ("orderItemId") WHERE status <> 'Cancelled'`) from day one.
  - `RadiologyRequisitionNumberGeneratorService.generateNextRequisitionNumber()` is called BEFORE `createRequisition` opens its own `runInTenantSchema()` — never nested inside it (mirrors `PatientsService.create`'s existing pattern).
  - Every status-transition mutator (`markScanned`, `enterReport`, `verify`, `cancel`) takes a `lock: { mode: 'pessimistic_write' }` on its initial requisition `findOne` lookup.
  - `createRequisition` rejects a cancelled `OrderItem` immediately (`BadRequestException`).
  - A `23505` unique-violation on `createRequisition`'s save is caught and translated to `ConflictException`, scoped by checking `(error as QueryFailedError & { constraint?: string }).constraint === 'UQ_radiology_requisitions_active_order_item'` — NOT a bare `error.code === '23505'` check (that would also catch an unrelated `requisitionNumber` collision and mislabel it — the exact gap Lab/LIS's final review flagged as a parked residual).
- RBAC permissions (exact names, nested-dot style matching Lab's `lab.catalog.manage`/`lab.read`/etc.): `radiology.catalog.manage` (Hospital Admin, Super Admin), `radiology.read` (Radiology Technician, Doctor), `radiology.requisition.create` (Radiology Technician — also gates `cancel`, same permission-reuse choice Lab made), `radiology.report.enter` (Radiology Technician), `radiology.report.verify` (Radiology Technician).
- No FK-level TypeORM relations anywhere (`@ManyToOne` etc.) — bare `uuid` columns only.
- No `tenantId` column on any entity — tenancy is enforced by Postgres schema/search_path via `TenantConnectionService`.
- Every relative import needs an explicit `.js` extension (`nodenext` module resolution).
- No class-validator decorators on DTOs — plain classes with `!`/`?` typing only.
- Third-party npm packages don't apply here (no new dependencies) — N/A.
- No automated tests this session (standing project instruction) — manual verification only, per each task's steps below.
- Never `git commit --amend`; new commit per task; no AI co-authorship trailer; conventional commit prefixes.
- Migration file: `0020-create-radiology-tables.ts`, class `CreateRadiologyTables0020`, `name = 'CreateRadiologyTables00202000000000017'` (following the established `<ClassName><paddedFileNum>2000000000<sequentialOrder>` pattern — 0019/Lab's index-fix was `...016`, this is the next tenant-migration slot, `...017`).

---

### Task 1: Migration — 4 Radiology tables (including the partial unique index from day one) + 3 entities

**Files:**
- Create: `apps/api/src/database/migrations/0020-create-radiology-tables.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: tables `radiology_imaging_types`, `radiology_imaging_items`, `radiology_requisitions`, `radiology_requisition_sequences` — exact columns below, consumed by Task 2's entities.

- [ ] **Step 1: Write the migration**

Create `apps/api/src/database/migrations/0020-create-radiology-tables.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRadiologyTables0020 implements MigrationInterface {
  name = 'CreateRadiologyTables00202000000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE radiology_imaging_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "procedureCoding" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE radiology_imaging_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "imagingTypeId" uuid NOT NULL,
        name varchar NOT NULL,
        "procedureCode" varchar NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_radiology_imaging_items_imaging_type_id" ON radiology_imaging_items ("imagingTypeId")`,
    );
    await queryRunner.query(`
      CREATE TABLE radiology_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "imagingItemId" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "scannedBy" uuid NULL,
        "scannedAt" timestamptz NULL,
        "reportText" text NULL,
        indication text NULL,
        "performerId" uuid NULL,
        "reportEnteredBy" uuid NULL,
        "reportEnteredAt" timestamptz NULL,
        "verifiedBy" uuid NULL,
        "verifiedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_radiology_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_radiology_requisitions_order_item_id" ON radiology_requisitions ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_radiology_requisitions_active_order_item"
      ON radiology_requisitions ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
    await queryRunner.query(`
      CREATE TABLE radiology_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE radiology_requisition_sequences`);
    await queryRunner.query(`DROP INDEX "UQ_radiology_requisitions_active_order_item"`);
    await queryRunner.query(`DROP TABLE radiology_requisitions`);
    await queryRunner.query(`DROP TABLE radiology_imaging_items`);
    await queryRunner.query(`DROP TABLE radiology_imaging_types`);
  }
}
```

Note: the partial unique index (`UQ_radiology_requisitions_active_order_item`) is created inline
in this initial migration — unlike Lab/LIS, which needed a separate follow-up migration
(`0019-add-lab-requisitions-active-unique-index.ts`) because its final review only caught the
gap after the fact. Building it in from the start avoids that extra migration entirely.

- [ ] **Step 2: Register the migration**

Current relevant lines in `apps/api/src/database/migrations/index.ts`:

```ts
import { CreateLabTables0018 } from './0018-create-lab-tables.js';
import { AddLabRequisitionsActiveUniqueIndex0019 } from './0019-add-lab-requisitions-active-unique-index.js';

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
  CreateLabTables0018,
  AddLabRequisitionsActiveUniqueIndex0019,
];
```

Add the import and append `CreateRadiologyTables0020` to the end of the `TENANT_MIGRATIONS` array:

```ts
import { CreateLabTables0018 } from './0018-create-lab-tables.js';
import { AddLabRequisitionsActiveUniqueIndex0019 } from './0019-add-lab-requisitions-active-unique-index.js';
import { CreateRadiologyTables0020 } from './0020-create-radiology-tables.js';

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
  AddLabRequisitionsActiveUniqueIndex0019,
  CreateRadiologyTables0020,
];
```

- [ ] **Step 3: Write the 3 entity files**

Create `apps/api/src/radiology/entities/radiology-imaging-type.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('radiology_imaging_types')
export class RadiologyImagingType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  procedureCoding!: string | null;

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/radiology/entities/radiology-imaging-item.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('radiology_imaging_items')
export class RadiologyImagingItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  imagingTypeId!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  procedureCode!: string | null;

  @Column({ type: 'int', default: 0 })
  displaySequence!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/radiology/entities/radiology-requisition.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('radiology_requisitions')
export class RadiologyRequisition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  orderItemId!: string;

  @Column({ type: 'uuid' })
  imagingItemId!: string;

  @Column({ type: 'varchar', unique: true })
  requisitionNumber!: string;

  @Column({ type: 'varchar', default: 'Pending' })
  status!: string; // 'Pending' | 'Scanned' | 'ReportEntered' | 'Verified' | 'Cancelled'

  @Column({ type: 'uuid', nullable: true })
  scannedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  scannedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  reportText!: string | null;

  @Column({ type: 'text', nullable: true })
  indication!: string | null;

  @Column({ type: 'uuid', nullable: true })
  performerId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  reportEnteredBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reportEnteredAt!: Date | null;

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

- [ ] **Step 4: Register the 3 new entities in `data-source.ts`**

Current relevant lines in `apps/api/src/database/data-source.ts`:

```ts
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

Add the 3 imports and append the 3 entity classes to the array (after `LabResult`):

```ts
import { LabTestCategory } from '../lab/entities/lab-test-category.entity.js';
import { LabTest } from '../lab/entities/lab-test.entity.js';
import { LabTestComponent } from '../lab/entities/lab-test-component.entity.js';
import { LabRequisition } from '../lab/entities/lab-requisition.entity.js';
import { LabResult } from '../lab/entities/lab-result.entity.js';
import { RadiologyImagingType } from '../radiology/entities/radiology-imaging-type.entity.js';
import { RadiologyImagingItem } from '../radiology/entities/radiology-imaging-item.entity.js';
import { RadiologyRequisition } from '../radiology/entities/radiology-requisition.entity.js';
import { PLATFORM_MIGRATIONS } from './migrations/index.js';
```
```ts
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer, Order, OrderItem, BillingSettings, BillingSequence, Invoice, InvoiceItem, Payment, Deposit, ReportingEvent, LabTestCategory, LabTest, LabTestComponent, LabRequisition, LabResult, RadiologyImagingType, RadiologyImagingItem, RadiologyRequisition],
```

Note: `radiology_requisition_sequences` deliberately has no corresponding TypeORM entity class,
same as Lab's `lab_requisition_sequences` and Patients' `patient_sequences` — it's queried only
via raw SQL by Task 3's generator service.

- [ ] **Step 5: Verify the migration runs**

Create a throwaway tenant via the existing `TenantProvisioningService` path (same approach used
in every prior item's manual verification this session) and confirm all 4 tables exist in that
tenant's schema, including the partial unique index — `psql \d radiology_requisitions` should
show `UQ_radiology_requisitions_active_order_item` as a unique index with a `WHERE` clause.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/database/migrations/0020-create-radiology-tables.ts apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts apps/api/src/radiology/entities/
git commit -m "feat(radiology): add Radiology core tables and entities"
```

---

### Task 2: RBAC — Radiology permissions and role mappings

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Consumes: `Radiology Technician` role (already exists in `ROLE_CATALOG`, zero permissions today).
- Produces: 5 permissions (`radiology.catalog.manage`, `radiology.read`,
  `radiology.requisition.create`, `radiology.report.enter`, `radiology.report.verify`) consumed
  by Task 4/5's `@RequirePermission()` decorators.

- [ ] **Step 1: Add the 5 permissions**

Current tail of `PERMISSION_CATALOG` (ends with the Lab entries):

```ts
  {
    name: 'lab.result.verify',
    description: 'Verify a fully-resulted lab requisition.',
  },
];
```

Add the 5 new entries before the closing `];`:

```ts
  {
    name: 'lab.result.verify',
    description: 'Verify a fully-resulted lab requisition.',
  },
  {
    name: 'radiology.catalog.manage',
    description: 'Create and list the radiology imaging type/item catalog.',
  },
  {
    name: 'radiology.read',
    description: 'View the radiology catalog, requisitions, and reports.',
  },
  {
    name: 'radiology.requisition.create',
    description: 'Create a radiology requisition from an order item.',
  },
  {
    name: 'radiology.report.enter',
    description: 'Mark a study scanned and enter its report text.',
  },
  {
    name: 'radiology.report.verify',
    description: 'Verify a fully-reported radiology requisition.',
  },
];
```

- [ ] **Step 2: Add role mappings**

Current tail of `ROLE_PERMISSION_MAPPINGS`:

```ts
  { roleName: 'Super Admin', permissionName: 'lab.result.verify' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.verify' },
];
```

Add the 12 new entries before the closing `];`:

```ts
  { roleName: 'Super Admin', permissionName: 'lab.result.verify' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.verify' },
  { roleName: 'Super Admin', permissionName: 'radiology.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'radiology.read' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.read' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.read' },
  { roleName: 'Doctor', permissionName: 'radiology.read' },
  { roleName: 'Super Admin', permissionName: 'radiology.requisition.create' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'radiology.report.enter' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.report.enter' },
  { roleName: 'Super Admin', permissionName: 'radiology.report.verify' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.report.verify' },
];
```

- [ ] **Step 3: Verify the seed runs cleanly**

Run: `pnpm exec nx test api --testPathPatterns=seed-rbac-catalog` (from `new/code`) — confirm it
still passes with the 5 new permissions and 14 new mappings inserted without constraint
violations.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add radiology permissions, wire Radiology Technician's first grants"
```

---

### Task 3: `RadiologyRequisitionNumberGeneratorService`

**Files:**
- Create: `apps/api/src/radiology/radiology-requisition-number-generator.service.ts`

**Interfaces:**
- Consumes: `TenantConnectionService.runInTenantSchema()` (existing).
- Produces: `RadiologyRequisitionNumberGeneratorService.generateNextRequisitionNumber(prefix = 'RAD'): Promise<string>`, consumed by Task 5's `createRequisition`.

- [ ] **Step 1: Write the service**

Create `apps/api/src/radiology/radiology-requisition-number-generator.service.ts` — copies the
same atomic-sequence pattern as `LabRequisitionNumberGeneratorService`/
`PatientNumberGeneratorService`, against the new `radiology_requisition_sequences` table:

```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class RadiologyRequisitionNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextRequisitionNumber(prefix = 'RAD'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO radiology_requisition_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = radiology_requisition_sequences."lastSequence" + 1
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
and calls `generateNextRequisitionNumber()` twice in a row — confirm sequential values (e.g.
`RAD-2026-00001`, `RAD-2026-00002`), then delete the scratch script.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/radiology/radiology-requisition-number-generator.service.ts
git commit -m "feat(radiology): add atomic requisition-number generator"
```

---

### Task 4: `RadiologyCatalogService` + `RadiologyCatalogController` + DTOs

**Files:**
- Create: `apps/api/src/radiology/radiology-catalog.service.ts`
- Create: `apps/api/src/radiology/radiology-catalog.controller.ts`
- Create: `apps/api/src/radiology/dto/create-radiology-imaging-type.dto.ts`
- Create: `apps/api/src/radiology/dto/create-radiology-imaging-item.dto.ts`

**Interfaces:**
- Consumes: `RadiologyImagingType`, `RadiologyImagingItem` entities (Task 1);
  `TenantConnectionService` (existing).
- Produces: `RadiologyCatalogService` with `createType`, `listTypes`, `createItem`,
  `listItemsByType`, `getItem` — consumed by Task 5's `createRequisition` (needs `getItem`).
- Does NOT create a `RadiologyModule` or touch `app.module.ts` — that's Task 5's job. This task's
  controller/service exist as standalone files, verified via direct service-level scratch-script
  calls (not reachable via HTTP yet).

- [ ] **Step 1: Write the DTOs**

Create `apps/api/src/radiology/dto/create-radiology-imaging-type.dto.ts`:

```ts
export class CreateRadiologyImagingTypeDto {
  name!: string;
  procedureCoding?: string;
  displaySequence?: number;
}
```

Create `apps/api/src/radiology/dto/create-radiology-imaging-item.dto.ts`:

```ts
export class CreateRadiologyImagingItemDto {
  imagingTypeId!: string;
  name!: string;
  procedureCode?: string;
  displaySequence?: number;
}
```

- [ ] **Step 2: Write `RadiologyCatalogService`**

Create `apps/api/src/radiology/radiology-catalog.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { RadiologyImagingType } from './entities/radiology-imaging-type.entity.js';
import { RadiologyImagingItem } from './entities/radiology-imaging-item.entity.js';

export interface CreateImagingTypeInput {
  name: string;
  procedureCoding?: string;
  displaySequence?: number;
}

export interface CreateImagingItemInput {
  imagingTypeId: string;
  name: string;
  procedureCode?: string;
  displaySequence?: number;
}

@Injectable()
export class RadiologyCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createType(input: CreateImagingTypeInput): Promise<RadiologyImagingType> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingType);
      return repository.save(
        repository.create({
          name: input.name,
          procedureCoding: input.procedureCoding ?? null,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listTypes(): Promise<RadiologyImagingType[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(RadiologyImagingType).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async createItem(input: CreateImagingItemInput): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const type = await manager
        .getRepository(RadiologyImagingType)
        .findOne({ where: { id: input.imagingTypeId } });
      if (!type) {
        throw new NotFoundException(`Radiology imaging type ${input.imagingTypeId} not found`);
      }

      const repository = manager.getRepository(RadiologyImagingItem);
      return repository.save(
        repository.create({
          imagingTypeId: input.imagingTypeId,
          name: input.name,
          procedureCode: input.procedureCode ?? null,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listItemsByType(imagingTypeId: string): Promise<RadiologyImagingItem[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(RadiologyImagingItem)
        .find({ where: { imagingTypeId }, order: { displaySequence: 'ASC' } }),
    );
  }

  async getItem(id: string): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.getRepository(RadiologyImagingItem).findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      return item;
    });
  }
}
```

- [ ] **Step 3: Write `RadiologyCatalogController`**

Create `apps/api/src/radiology/radiology-catalog.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { CreateRadiologyImagingTypeDto } from './dto/create-radiology-imaging-type.dto.js';
import { CreateRadiologyImagingItemDto } from './dto/create-radiology-imaging-item.dto.js';

@Controller('radiology')
@UseGuards(PermissionGuard)
export class RadiologyCatalogController {
  constructor(private readonly radiologyCatalogService: RadiologyCatalogService) {}

  @Post('types')
  @RequirePermission('radiology.catalog.manage')
  async createType(@Body() dto: CreateRadiologyImagingTypeDto) {
    return this.radiologyCatalogService.createType(dto);
  }

  @Get('types')
  @RequirePermission('radiology.read')
  async listTypes() {
    return this.radiologyCatalogService.listTypes();
  }

  @Post('items')
  @RequirePermission('radiology.catalog.manage')
  async createItem(@Body() dto: CreateRadiologyImagingItemDto) {
    return this.radiologyCatalogService.createItem(dto);
  }

  @Get('types/:imagingTypeId/items')
  @RequirePermission('radiology.read')
  async listItemsByType(@Param('imagingTypeId') imagingTypeId: string) {
    return this.radiologyCatalogService.listItemsByType(imagingTypeId);
  }

  @Get('items/:id')
  @RequirePermission('radiology.read')
  async getItem(@Param('id') id: string) {
    return this.radiologyCatalogService.getItem(id);
  }
}
```

- [ ] **Step 4: Verify via a scratch script**

Write a scratch script (do not commit) that, against a live tenant schema, creates an imaging
type, creates an item under it, then lists each level back and confirms the data matches. Delete
the scratch script afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/radiology/radiology-catalog.service.ts apps/api/src/radiology/radiology-catalog.controller.ts apps/api/src/radiology/dto/create-radiology-imaging-type.dto.ts apps/api/src/radiology/dto/create-radiology-imaging-item.dto.ts
git commit -m "feat(radiology): add radiology catalog service and controller"
```

---

### Task 5: `RadiologyWorkflowService` + `RadiologyWorkflowController` + module wiring + full pipeline verification

**Files:**
- Create: `apps/api/src/radiology/radiology-workflow.service.ts`
- Create: `apps/api/src/radiology/radiology-workflow.controller.ts`
- Create: `apps/api/src/radiology/dto/create-radiology-requisition.dto.ts`
- Create: `apps/api/src/radiology/dto/mark-scanned.dto.ts`
- Create: `apps/api/src/radiology/dto/enter-report.dto.ts`
- Create: `apps/api/src/radiology/dto/verify-radiology-requisition.dto.ts`
- Create: `apps/api/src/radiology/dto/cancel-radiology-requisition.dto.ts`
- Create: `apps/api/src/radiology/radiology.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `RadiologyRequisition` entity (Task 1); `RadiologyRequisitionNumberGeneratorService`
  (Task 3); `RadiologyCatalogService.getItem` (Task 4); `OrderItem` entity (existing).
- Produces: `RadiologyWorkflowService` with `createRequisition`, `findOne`, `listByOrderItem`,
  `markScanned`, `enterReport`, `verify`, `cancel` — this is the plan's terminal functional task,
  nothing later consumes these.

- [ ] **Step 1: Write the DTOs**

Create `apps/api/src/radiology/dto/create-radiology-requisition.dto.ts`:

```ts
export class CreateRadiologyRequisitionDto {
  orderItemId!: string;
  imagingItemId!: string;
}
```

Create `apps/api/src/radiology/dto/mark-scanned.dto.ts`:

```ts
export class MarkScannedDto {
  scannedBy!: string;
}
```

Create `apps/api/src/radiology/dto/enter-report.dto.ts`:

```ts
export class EnterReportDto {
  reportText!: string;
  indication?: string;
  performerId?: string;
  reportEnteredBy!: string;
}
```

Create `apps/api/src/radiology/dto/verify-radiology-requisition.dto.ts`:

```ts
export class VerifyRadiologyRequisitionDto {
  verifiedBy!: string;
}
```

Create `apps/api/src/radiology/dto/cancel-radiology-requisition.dto.ts`:

```ts
export class CancelRadiologyRequisitionDto {
  cancelReason?: string;
}
```

- [ ] **Step 2: Write `RadiologyWorkflowService`**

Create `apps/api/src/radiology/radiology-workflow.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { RadiologyRequisition } from './entities/radiology-requisition.entity.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';
import { RadiologyCatalogService } from './radiology-catalog.service.js';

export interface CreateRequisitionInput {
  orderItemId: string;
  imagingItemId: string;
}

export interface EnterReportInput {
  reportText: string;
  indication?: string;
  performerId?: string;
  reportEnteredBy: string;
}

const NON_TERMINAL_STATUSES = ['Pending', 'Scanned', 'ReportEntered'];

@Injectable()
export class RadiologyWorkflowService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: RadiologyRequisitionNumberGeneratorService,
    private readonly radiologyCatalogService: RadiologyCatalogService,
  ) {}

  async createRequisition(input: CreateRequisitionInput): Promise<RadiologyRequisition> {
    await this.radiologyCatalogService.getItem(input.imagingItemId); // throws NotFoundException if missing

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Radiology') {
        throw new BadRequestException(
          `Order item ${input.orderItemId} is not a Radiology order (itemType: ${orderItem.itemType})`,
        );
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be requisitioned`);
      }

      const requisitionRepository = manager.getRepository(RadiologyRequisition);
      const existing = await requisitionRepository.findOne({
        where: { orderItemId: input.orderItemId, status: Not('Cancelled') },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled requisition (${existing.id})`,
        );
      }

      try {
        return await requisitionRepository.save(
          requisitionRepository.create({
            orderItemId: input.orderItemId,
            imagingItemId: input.imagingItemId,
            requisitionNumber,
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_radiology_requisitions_active_order_item'
        ) {
          throw new ConflictException(`Order item ${input.orderItemId} already has a non-cancelled requisition`);
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(RadiologyRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      return requisition;
    });
  }

  async listByOrderItem(orderItemId: string): Promise<RadiologyRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(RadiologyRequisition).find({ where: { orderItemId }, order: { createdAt: 'DESC' } }),
    );
  }

  async markScanned(id: string, scannedBy: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} must be Pending to mark scanned (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'Scanned';
      requisition.scannedBy = scannedBy;
      requisition.scannedAt = new Date();
      return repository.save(requisition);
    });
  }

  async enterReport(id: string, input: EnterReportInput): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status === 'Verified') {
        throw new ConflictException(`Requisition ${id} is already verified; the report is locked`);
      }
      if (requisition.status === 'Cancelled') {
        throw new ConflictException(`Requisition ${id} is cancelled`);
      }
      if (requisition.status === 'Pending') {
        throw new ConflictException(`Requisition ${id} must be scanned before entering a report`);
      }

      requisition.reportText = input.reportText;
      requisition.indication = input.indication ?? null;
      requisition.performerId = input.performerId ?? null;
      requisition.reportEnteredBy = input.reportEnteredBy;
      requisition.reportEnteredAt = new Date();
      requisition.status = 'ReportEntered';
      return repository.save(requisition);
    });
  }

  async verify(id: string, verifiedBy: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (requisition.status !== 'ReportEntered') {
        throw new ConflictException(
          `Requisition ${id} must have a report entered before verification (current status: ${requisition.status})`,
        );
      }

      requisition.status = 'Verified';
      requisition.verifiedBy = verifiedBy;
      requisition.verifiedAt = new Date();
      return repository.save(requisition);
    });
  }

  async cancel(id: string, cancelReason?: string): Promise<RadiologyRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Radiology requisition ${id} not found`);
      }
      if (!NON_TERMINAL_STATUSES.includes(requisition.status)) {
        throw new ConflictException(`Requisition ${id} cannot be cancelled from status ${requisition.status}`);
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }
}
```

Note the two structural differences from Lab's `enterResult`, both intentional simplifications
made possible by the "one report per requisition" design (see spec): `enterReport` has no
`ON CONFLICT` upsert (it's a plain conditional `UPDATE` via `repository.save()`, since there's
only ever one row to update, not N per-component rows), and `verify`'s guard is a direct
`status !== 'ReportEntered'` check with no coverage-recomputation needed (unlike Lab's `verify`,
which had to re-derive component coverage because that status could go stale relative to a
catalog that gained components after the fact — no such drift is possible here, since
`ReportEntered` and `reportText` are written atomically in the same statement, by the same
method, from the same source, always).

- [ ] **Step 3: Write `RadiologyWorkflowController`**

Create `apps/api/src/radiology/radiology-workflow.controller.ts`:

```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { CreateRadiologyRequisitionDto } from './dto/create-radiology-requisition.dto.js';
import { MarkScannedDto } from './dto/mark-scanned.dto.js';
import { EnterReportDto } from './dto/enter-report.dto.js';
import { VerifyRadiologyRequisitionDto } from './dto/verify-radiology-requisition.dto.js';
import { CancelRadiologyRequisitionDto } from './dto/cancel-radiology-requisition.dto.js';

@Controller('radiology/requisitions')
@UseGuards(PermissionGuard)
export class RadiologyWorkflowController {
  constructor(private readonly radiologyWorkflowService: RadiologyWorkflowService) {}

  @Post()
  @RequirePermission('radiology.requisition.create')
  async create(@Body() dto: CreateRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('radiology.read')
  async listByOrderItem(@Query('orderItemId') orderItemId: string) {
    return this.radiologyWorkflowService.listByOrderItem(orderItemId);
  }

  @Get(':id')
  @RequirePermission('radiology.read')
  async findOne(@Param('id') id: string) {
    return this.radiologyWorkflowService.findOne(id);
  }

  @Patch(':id/mark-scanned')
  @RequirePermission('radiology.report.enter')
  async markScanned(@Param('id') id: string, @Body() dto: MarkScannedDto) {
    return this.radiologyWorkflowService.markScanned(id, dto.scannedBy);
  }

  @Post(':id/report')
  @RequirePermission('radiology.report.enter')
  async enterReport(@Param('id') id: string, @Body() dto: EnterReportDto) {
    return this.radiologyWorkflowService.enterReport(id, dto);
  }

  @Patch(':id/verify')
  @RequirePermission('radiology.report.verify')
  async verify(@Param('id') id: string, @Body() dto: VerifyRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.verify(id, dto.verifiedBy);
  }

  @Patch(':id/cancel')
  @RequirePermission('radiology.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelRadiologyRequisitionDto) {
    return this.radiologyWorkflowService.cancel(id, dto.cancelReason);
  }
}
```

- [ ] **Step 4: Write `RadiologyModule` and wire it into `AppModule`**

Create `apps/api/src/radiology/radiology.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { RadiologyCatalogService } from './radiology-catalog.service.js';
import { RadiologyCatalogController } from './radiology-catalog.controller.js';
import { RadiologyWorkflowService } from './radiology-workflow.service.js';
import { RadiologyWorkflowController } from './radiology-workflow.controller.js';
import { RadiologyRequisitionNumberGeneratorService } from './radiology-requisition-number-generator.service.js';

@Module({
  controllers: [RadiologyCatalogController, RadiologyWorkflowController],
  providers: [RadiologyCatalogService, RadiologyWorkflowService, RadiologyRequisitionNumberGeneratorService],
  exports: [RadiologyCatalogService, RadiologyWorkflowService],
})
export class RadiologyModule {}
```

Current relevant lines in `apps/api/src/app/app.module.ts`:

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

Add the import and add `RadiologyModule` to the `imports` array (after `LabModule`, matching the
file's existing append-at-the-end convention):

```ts
import { ReportingModule } from '../reporting/reporting.module.js';
import { LabModule } from '../lab/lab.module.js';
import { RadiologyModule } from '../radiology/radiology.module.js';
```
```ts
    BillingModule,
    ReportingModule,
    LabModule,
    RadiologyModule,
  ],
```

- [ ] **Step 5: Full pipeline manual verification**

Write a scratch script (do not commit) that, against a live tenant schema:
1. Creates an imaging type and item (via `RadiologyCatalogService`, from Task 4).
2. Creates an `Order` + `OrderItem` (`itemType: 'Radiology'`) via the existing Orders module.
3. Calls `createRequisition` — confirm status `'Pending'` and a `requisitionNumber` like
   `RAD-2026-NNNNN`.
4. Calls `markScanned` — confirm status `'Scanned'`.
5. Calls `enterReport` — confirm status `'ReportEntered'`, `reportText` stored.
6. Calls `enterReport` again with different text — confirm the `reportText` is overwritten (a
   plain update, not a new row — query `radiology_requisitions` directly and confirm exactly one
   row for this requisition, as expected — this step exists mainly to confirm no accidental
   duplication logic crept in, unlike Lab where the analogous check was load-bearing).
7. Calls `verify` — confirm status `'Verified'`, `verifiedBy`/`verifiedAt` set.
8. Calls `enterReport` again post-verification — confirm it throws `ConflictException`.
9. Attempts `cancel` on the now-`'Verified'` requisition — confirm it throws `ConflictException`.
10. Creates a SECOND `Order` + `OrderItem` (`itemType: 'Radiology'`, call it `OrderItem-B` — must
    be a distinct order item from step 2's, since that one already has a live `'Verified'`
    requisition and cannot take a second non-cancelled one), creates a requisition against
    `OrderItem-B`, and cancels it while still `'Pending'` — confirm status `'Cancelled'` and
    `cancelReason` stored.
11. **The specific race Lab's final review flagged** — with `OrderItem-B`'s only requisition now
    `'Cancelled'` (non-blocking), attempt a THIRD `createRequisition` call for `OrderItem-B`.
    Confirm this succeeds (a new, distinct, `'Pending'` requisition — proving a cancelled
    requisition never blocks a legitimate re-request). Then, while that third requisition is
    still live, attempt a FOURTH `createRequisition` call also for `OrderItem-B` — confirm it's
    rejected with `ConflictException` (proving the partial unique index actually prevents two
    simultaneous live requisitions for the same order item).
12. Attempt `createRequisition` against a `Cancelled` order item (mark `OrderItem-B` cancelled
    directly, then try once more) — confirm `BadRequestException`.

Delete the scratch script afterward, and drop the throwaway tenant per this session's established
pattern (ask for confirmation before the destructive DB operations, per standing practice).

- [ ] **Step 6: Confirm the rest of the suite is unaffected**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`) — confirm the only failure is the
pre-existing, already-tracked `persisting-reporting-event-publisher.integration-spec.ts` one, same
baseline as every prior item this session.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/radiology/radiology-workflow.service.ts apps/api/src/radiology/radiology-workflow.controller.ts apps/api/src/radiology/dto/create-radiology-requisition.dto.ts apps/api/src/radiology/dto/mark-scanned.dto.ts apps/api/src/radiology/dto/enter-report.dto.ts apps/api/src/radiology/dto/verify-radiology-requisition.dto.ts apps/api/src/radiology/dto/cancel-radiology-requisition.dto.ts apps/api/src/radiology/radiology.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(radiology): add radiology workflow service, controller, and module wiring"
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

The file currently ends with `## 14. Lab/LIS Core Pipeline`'s content, ending in:

```
See `new/docs/superpowers/plans/2026-08-05-lab-lis-module.md` for the full implementation
history.
```

Append after that:

```markdown

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

See `new/docs/superpowers/plans/2026-08-05-radiology-module.md` for the full implementation
history.
```

- [ ] **Step 2: Update `pending-tasks.md`**

Current relevant lines (from the Lab/LIS item's own doc update):

```
- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. **Not done:** report/PDF export, machine/instrument
        (LIS) integration, external lab send-out, government disease-reporting mapping,
        multi-level verification, catalog update/delete (create+list only shipped; see
        `Development-Standards.md` §14), result amendment history/audit trail (corrections
        currently overwrite in place with no version row — acceptable for now since only
        pre-verification edits are allowed, but named explicitly rather than left silent), and
        `OrderItem.status` never advancing when its lab requisition is verified (the ordering
        doctor has no signal from the Order module itself that results are ready; they'd need to
        check Lab directly) — each a distinct future item.
  - Radiology, DICOM, Pharmacy, Inventory, Ward Supply — not started
```

Replace with a checked-off sub-item for Radiology, keeping the rest of the still-pending domains
listed:

```
- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. **Not done:** report/PDF export, machine/instrument
        (LIS) integration, external lab send-out, government disease-reporting mapping,
        multi-level verification, catalog update/delete (create+list only shipped; see
        `Development-Standards.md` §14), result amendment history/audit trail (corrections
        currently overwrite in place with no version row — acceptable for now since only
        pre-verification edits are allowed, but named explicitly rather than left silent), and
        `OrderItem.status` never advancing when its lab requisition is verified (the ordering
        doctor has no signal from the Order module itself that results are ready; they'd need to
        check Lab directly) — each a distinct future item.
  - [x] Radiology core pipeline (imaging catalog, requisition/scan tracking, single-field report
        entry, single-level verification) — done. **Not done:** image attachment
        (`@hospital/object-storage` integration), film type/quantity billing tracking, DICOM
        integration (confirmed a wholly separate old-system domain — its own models, own
        controller), report template HTML rendering/PDF export, catalog update/delete (create+list
        only, same scope cut as Lab), result amendment history/audit trail, and `OrderItem.status`
        never advancing on verification (same two gaps Lab has, named here rather than left
        silent) — each a distinct future item.
  - DICOM, Pharmacy, Inventory, Ward Supply — not started
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document Radiology core pipeline, update Phase 6 backlog status"
```
