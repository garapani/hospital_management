# Appointment & Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `appointments` as a new domain module inside `apps/api` — receptionists can book/cancel appointments for both walk-in and registered patients, and clinical staff can view schedules.

**Architecture:** New `apps/api/src/appointments/` domain folder. Appointments are a per-tenant table (inside `tenant_<hospitalId>`). The migration is added to `AccountsService.provisionTenantSchema`'s per-tenant migration list. Reads/writes go through `TenantConnectionService` (from the shared `DatabaseModule`). Emits audit events via `@hospital/audit-emitter`. 

**Tech Stack:** NestJS/TypeScript, TypeORM, Jest.

## Global Constraints

- Every relative import needs an explicit `.js` extension.
- Use `--testPathPatterns` (plural) if running Jest directly on a subset of files.
- Mutating service methods use load-then-`save()`, never `.update()`/`.increment()`/`.decrement()`.
- No `ValidationPipe`/class-validator on DTOs.
- `apps/api/src/database/migrate.ts` is known-broken (pre-existing). The migration is tenant-scoped (applied dynamically via `provisionTenantSchema`).
- Follow this workspace's git conventions: never `git commit --amend`, never add AI co-authorship trailers, and `git add` only the exact files named in each task.
- Each test file provisions its own distinct tenant schema (e.g. `test_appointments_svc`, `test_appointments_ctrl`, `test_appointments_permgate`) dropped via `DROP SCHEMA ... CASCADE` in `afterAll`.

---

### Task 1: Seed permissions (`appointment.manage`, `appointment.read`)

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`

**Interfaces:**
- Produces: `appointment.manage` and `appointment.read` permission rows, mapped to their respective roles (Manage: Receptionist / Front Desk, Hospital Admin. Read: Doctor, Nurse).

- [ ] **Step 1: Write the failing tests**

Add these tests to `seed-rbac-catalog.integration-spec.ts` (inside the `describe` block):

```typescript
  it('creates the appointment.manage and appointment.read permissions', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps appointment permissions to correct roles', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map(m => roles.find(r => r.id === m.roleId)!.name);
    expect(manageRoleNames).toEqual(expect.arrayContaining(['Hospital Admin', 'Receptionist / Front Desk']));
    
    const readRoleNames = readMappings.map(m => roles.find(r => r.id === m.roleId)!.name);
    expect(readRoleNames).toEqual(expect.arrayContaining(['Doctor', 'Nurse']));
  });
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx nx test api --testPathPatterns=seed-rbac-catalog`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Modify `apps/api/src/rbac/seed-rbac-catalog.ts` to add the permissions and Role mappings:

```typescript
// Add to PERMISSION_CATALOG
  { name: 'appointment.manage', description: 'Book, modify, and cancel appointments', isActive: true },
  { name: 'appointment.read', description: 'View appointment schedules', isActive: true },

// Add to mappings logic inside seedRbacCatalog()
  const managePerm = await permissionRepo.findOneOrFail({ where: { name: 'appointment.manage' } });
  const readPerm = await permissionRepo.findOneOrFail({ where: { name: 'appointment.read' } });
  
  await grantPermission(roleRepo, rolePermissionRepo, 'Receptionist / Front Desk', managePerm.id);
  await grantPermission(roleRepo, rolePermissionRepo, 'Hospital Admin', managePerm.id);
  
  await grantPermission(roleRepo, rolePermissionRepo, 'Doctor', readPerm.id);
  await grantPermission(roleRepo, rolePermissionRepo, 'Nurse', readPerm.id);
```
*(Use the existing `grantPermission` helper logic or equivalent in that file).*

- [ ] **Step 4: Run test to verify it passes**
Run: `npx nx test api --testPathPatterns=seed-rbac-catalog`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: add appointment RBAC permissions"
```

---

### Task 2: Appointment Entity & Migration

**Files:**
- Create: `apps/api/src/appointments/entities/appointment.entity.ts`
- Create: `apps/api/src/database/migrations/<timestamp>-create-appointments-table.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: `Appointment` entity, registered in `data-source.ts`, and migration wired into `provisionTenantSchema`.

- [ ] **Step 1: Write the entity**

`apps/api/src/appointments/entities/appointment.entity.ts`:
```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('appointments')
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  patientId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  firstName!: string;

  @Column({ type: 'varchar', length: 100 })
  lastName!: string;

  @Column({ type: 'varchar', length: 20 })
  contactNumber!: string;

  @Column({ type: 'date' })
  appointmentDate!: string;

  @Column({ type: 'time' })
  appointmentTime!: string;

  @Column({ type: 'uuid', nullable: true })
  doctorId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  departmentId!: string | null;

  @Column({ type: 'varchar', length: 50 })
  appointmentType!: string;

  @Column({ type: 'varchar', length: 50 })
  status!: string;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'text', nullable: true })
  cancelledRemarks!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/database/migrations/1738200000004-create-appointments-table.ts` (increment timestamp accordingly if needed, check existing files):

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAppointmentsTable1738200000004 implements MigrationInterface {
  name = 'CreateAppointmentsTable1738200000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE appointments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NULL,
        "firstName" varchar(100) NOT NULL,
        "lastName" varchar(100) NOT NULL,
        "contactNumber" varchar(20) NOT NULL,
        "appointmentDate" date NOT NULL,
        "appointmentTime" time NOT NULL,
        "doctorId" uuid NULL,
        "departmentId" uuid NULL,
        "appointmentType" varchar(50) NOT NULL,
        "status" varchar(50) NOT NULL,
        "reason" text NULL,
        "cancelledRemarks" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE appointments`);
  }
}
```

- [ ] **Step 3: Register in data-source.ts**

Modify `apps/api/src/database/data-source.ts`:
Add `import { Appointment } from '../appointments/entities/appointment.entity.js';`
Add `Appointment` to the `entities` array.

- [ ] **Step 4: Wire migration into tenant provisioning**

Modify `apps/api/src/accounts/accounts.service.ts`:
Import the migration and append it to the `migrations` array inside `provisionTenantSchema()`.

- [ ] **Step 5: Verify build**
Run: `npx nx run api:typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/appointments/entities/appointment.entity.ts apps/api/src/database/migrations/*create-appointments-table.ts apps/api/src/database/data-source.ts apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add appointment entity and per-tenant migration"
```

---

### Task 3: Appointments Service

**Files:**
- Create: `apps/api/src/appointments/appointments.service.ts`
- Create: `apps/api/src/appointments/appointments.service.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantConnectionService`, `PersistingAuditEventPublisher`.
- Produces: `AppointmentsService` with `create`, `update`, `cancel`, `list`, `getById`.

- [ ] **Step 1: Write the failing service test**

Create `apps/api/src/appointments/appointments.service.integration-spec.ts` asserting that an appointment can be created and retrieved, and cancelling it requires remarks. Assert Audit events are emitted. Set up a disposable schema `test_appointments_svc` in `beforeAll` using `AccountsService.provisionTenantSchema`.

- [ ] **Step 2: Run test to verify it fails**
Run: `npx nx test api --testPathPatterns=appointments.service`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/src/appointments/appointments.service.ts`:
Inject `TenantConnectionService` and `PersistingAuditEventPublisher`.
Implement `create`, `update`, `cancel` (throw if `cancelledRemarks` missing), `list`, `getById`. All DB calls must use `tenantConnection.runInTenantSchema()`. Emit audit events (e.g. `auditPublisher.publish(..., 'create', ...)`).

- [ ] **Step 4: Run test to verify it passes**
Run: `npx nx test api --testPathPatterns=appointments.service`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/appointments/appointments.service*
git commit -m "feat: add AppointmentsService with CRUD and audit support"
```

---

### Task 4: Appointments Controller & Module

**Files:**
- Create: `apps/api/src/appointments/appointments.controller.ts`
- Create: `apps/api/src/appointments/appointments.module.ts`
- Create: `apps/api/src/appointments/appointments.controller.integration-spec.ts`
- Create: `apps/api/src/appointments/appointments-permission-gating.integration-spec.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Produces: REST endpoints `POST /appointments`, `GET /appointments`, `GET /appointments/:id`, `PUT /appointments/:id`, `PUT /appointments/:id/cancel` protected by `@hospital/auth-guards`.

- [ ] **Step 1: Write the failing tests**

Create `appointments.controller.integration-spec.ts` (validates HTTP 200/201 on valid requests, sets up `test_appointments_ctrl` schema).
Create `appointments-permission-gating.integration-spec.ts` (validates HTTP 403 when lacking `appointment.manage`/`read` permissions, sets up `test_appointments_permgate` schema).

- [ ] **Step 2: Run tests to verify they fail**
Run: `npx nx test api --testPathPatterns=appointments`

- [ ] **Step 3: Write minimal implementation**

Create `appointments.controller.ts`. Apply `@UseGuards(RequirePermissionsGuard)` and `@RequirePermissions('appointment.manage')` or `read` where appropriate. 
Create `appointments.module.ts` providing the controller and service, importing `TenantContextModule` and `AuditModule`.
Modify `app.module.ts` to import `AppointmentsModule`.

- [ ] **Step 4: Run tests to verify they pass**
Run: `npx nx test api --testPathPatterns=appointments`

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/appointments apps/api/src/app/app.module.ts
git commit -m "feat: add AppointmentsController and wire AppointmentsModule into AppModule"
```
