# Clinical Vitals & Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Vitals & Triage subsystem to record physiological measurements and nursing triage observations, replacing legacy models.

**Architecture:** New NestJS module `VitalsModule` following the modular monolith pattern with tenant-scoped operations using `TenantConnectionService`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest.

## Global Constraints

- Tenant data isolation via `TenantConnectionService` is mandatory for all operations.
- Authorization via `@RequirePermission` and `PermissionGuard` is mandatory for all endpoints.
- TypeORM entities must be registered in the global `data-source.ts`.
- Schema migrations must be invoked explicitly in `AccountsService.provisionTenantSchema`.

---

### Task 1: Seed RBAC Permissions

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`

**Interfaces:**
- Consumes: `RolePermission` and `Role` entities.
- Produces: Mapped permissions `vitals.manage` and `vitals.read`.

- [ ] **Step 1: Write the failing test**

```typescript
// in apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
// Add tests for vitals.manage and vitals.read permissions
  it('seeds vitals permissions', async () => {
    const permissionRepo = dataSource.getRepository(Permission);
    const managePerm = await permissionRepo.findOne({ where: { id: 'vitals.manage' } });
    const readPerm = await permissionRepo.findOne({ where: { id: 'vitals.read' } });
    
    expect(managePerm).toBeDefined();
    expect(managePerm?.name).toBe('Manage Vitals');
    expect(readPerm).toBeDefined();
    expect(readPerm?.name).toBe('Read Vitals');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPatterns=seed-rbac-catalog`
Expected: FAIL due to missing permissions in the database.

- [ ] **Step 3: Write minimal implementation**

```typescript
// in apps/api/src/rbac/seed-rbac-catalog.ts
// Add to PLATFORM_PERMISSIONS
  {
    id: 'vitals.manage',
    name: 'Manage Vitals',
    description: 'Create, update, and void patient vitals',
    systemRoleMappings: ['Nurse', 'Doctor', 'Hospital Admin', 'Super Admin'],
  },
  {
    id: 'vitals.read',
    name: 'Read Vitals',
    description: 'View patient vitals',
    systemRoleMappings: ['Nurse', 'Doctor', 'Hospital Admin', 'Receptionist / Front Desk', 'Super Admin'],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPatterns=seed-rbac-catalog`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: add vitals permissions"
```

---

### Task 2: Vitals Entity and Migration

**Files:**
- Create: `apps/api/src/clinical/vitals/entities/vital.entity.ts`
- Create: `apps/api/src/database/migrations/0010-create-vitals-table.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Consumes: Base TypeORM setup.
- Produces: `Vital` entity and database table in the tenant schema.

- [ ] **Step 1: Write the minimal implementation**

```typescript
// in apps/api/src/clinical/vitals/entities/vital.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('vitals')
export class Vital {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  patientId!: string;

  @Column({ type: 'uuid', nullable: true })
  appointmentId?: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  height?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  weight?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  bmi?: number;

  @Column({ type: 'decimal', precision: 4, scale: 1, nullable: true })
  temperature?: number;

  @Column({ type: 'int', nullable: true })
  pulse?: number;

  @Column({ type: 'int', nullable: true })
  bpSystolic?: number;

  @Column({ type: 'int', nullable: true })
  bpDiastolic?: number;

  @Column({ type: 'int', nullable: true })
  respiratoryRate?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  spO2?: number;

  @Column({ type: 'int', nullable: true })
  painScale?: number;

  @Column({ type: 'text', nullable: true })
  triageNotes?: string;

  @Column({ type: 'timestamp with time zone', default: () => 'CURRENT_TIMESTAMP' })
  recordedAt!: Date;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;
}
```

```typescript
// in apps/api/src/database/migrations/0010-create-vitals-table.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVitalsTable0010 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE vitals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL REFERENCES patients(id),
        "appointmentId" uuid REFERENCES appointments(id),
        height decimal(5,2),
        weight decimal(5,2),
        bmi decimal(5,2),
        temperature decimal(4,1),
        pulse int,
        "bpSystolic" int,
        "bpDiastolic" int,
        "respiratoryRate" int,
        "spO2" decimal(5,2),
        "painScale" int,
        "triageNotes" text,
        "recordedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
        "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
      CREATE INDEX idx_vitals_patient_id ON vitals("patientId");
      CREATE INDEX idx_vitals_appointment_id ON vitals("appointmentId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE vitals`);
  }
}
```

- [ ] **Step 2: Update Data Source and Accounts Service**

Add `Vital` to `apps/api/src/database/data-source.ts`.
Add `CreateVitalsTable0010` invocation to `provisionTenantSchema` in `apps/api/src/accounts/accounts.service.ts`.

- [ ] **Step 3: Run Typecheck**

Run: `npx nx run api:typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/clinical/vitals apps/api/src/database apps/api/src/accounts
git commit -m "feat: add vitals entity and migration"
```

---

### Task 3: Vitals Service

**Files:**
- Create: `apps/api/src/clinical/vitals/vitals.service.ts`
- Create: `apps/api/src/clinical/vitals/vitals.service.integration-spec.ts`

**Interfaces:**
- Consumes: `Vital` entity, `TenantConnectionService`.
- Produces: `VitalsService` with `create`, `update`, `void`, `listByPatient`, `listByAppointment`.

- [ ] **Step 1: Write the failing test**

```typescript
// in apps/api/src/clinical/vitals/vitals.service.integration-spec.ts
// Add integration tests testing tenant isolation and CRUD logic for VitalsService
// Follow pattern from patients.service.integration-spec.ts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPatterns=vitals.service`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// in apps/api/src/clinical/vitals/vitals.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { Vital } from './entities/vital.entity.js';

export type CreateVitalInput = Omit<Vital, 'id' | 'createdAt' | 'updatedAt' | 'bmi'>;
export type UpdateVitalInput = Partial<CreateVitalInput>;

@Injectable()
export class VitalsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}
  
  // Implement CRUD mapped to the tenant connection manager
}
```

*(Note: Automatically calculate BMI during create/update if height and weight are provided).*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPatterns=vitals.service`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clinical/vitals
git commit -m "feat: add vitals service"
```

---

### Task 4: Vitals Controller & Module

**Files:**
- Create: `apps/api/src/clinical/vitals/vitals.controller.ts`
- Create: `apps/api/src/clinical/vitals/vitals.module.ts`
- Create: `apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `VitalsService`, `RequirePermission`, `PermissionGuard`.
- Produces: Protected REST API for Vitals.

- [ ] **Step 1: Write the failing test**

```typescript
// in apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts
// E2E test verifying @RequirePermission and @UseGuards(PermissionGuard) are applied
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test api --testPathPatterns=vitals.controller`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// in apps/api/src/clinical/vitals/vitals.controller.ts
import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { VitalsService, CreateVitalInput, UpdateVitalInput } from './vitals.service.js';

@Controller('vitals')
@UseGuards(PermissionGuard)
export class VitalsController {
  // Implement POST /vitals, GET /patients/:patientId/vitals, GET /appointments/:appointmentId/vitals, PUT /vitals/:id, DELETE /vitals/:id
}
```
*(Also implement `VitalsModule` and add to `AppModule`)*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test api --testPathPatterns=vitals.controller`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/clinical/vitals apps/api/src/app
git commit -m "feat: add vitals controller and module"
```
