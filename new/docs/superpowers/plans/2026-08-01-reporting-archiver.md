# Reporting/Dashboard Event Archiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Reporting/Dashboard module's Phase 1 slice — an in-process event archiver that captures six named business events (order placed, invoice created, payment recorded, deposit received, patient admitted, bed transferred) into a tenant-scoped `reporting_events` table, so history exists for the Phase 6 dashboard to read later.

**Architecture:** New `ReportingModule` (`apps/api/src/reporting/`), structurally parallel to the existing `AuditModule` (`apps/api/src/audit/`): a TypeORM `EventSubscriber` pushed onto `dataSource.subscribers` by a wiring service, publishing through an injectable publisher interface to a tenant-scoped entity. Unlike Audit's opt-out blanket coverage (every entity, filtered by exclusion), this subscriber is opt-in: a static map of exactly six entity classes to named event types and payload builders — anything else is silently ignored.

**Tech Stack:** NestJS, TypeORM (`@EventSubscriber()`), PostgreSQL (tenant-per-schema), Jest integration tests against real Postgres.

## Global Constraints

- Every relative import needs an explicit `.js` extension (NodeNext module resolution).
- Nullable entity columns are always typed `field!: T | null` with `@Column({ nullable: true })` — never bare `field?: T`.
- Every new migration must be registered in BOTH `apps/api/src/database/data-source.ts` (`entities`/`migrations` arrays) AND explicitly invoked in `AccountsService.provisionTenantSchema` (`apps/api/src/accounts/accounts.service.ts`).
- The subscriber must never throw and must never block or fail the business transaction that triggered it — a failed reporting-event write is logged and swallowed, exactly matching `PersistingAuditEventPublisher`'s resilience contract in `apps/api/src/audit/persisting-audit-event-publisher.ts`.
- This module captures **insert-only** events. No `afterUpdate`/`afterRemove` handling — every event maps 1:1 to a brand-new row being created, with payload fields read directly off that row (no cross-entity queries at event-emission time).
- `ReportingEvent` (the archive table's entity) must be excluded from Audit's own blanket coverage via `@AuditExcludeEntity()` from `@hospital/audit-emitter`, matching `AuditRecord`'s own precedent (`apps/api/src/audit/entities/audit-record.entity.ts`) — an internal, system-generated log table doesn't need a "who changed this" audit trail of its own.
- No RBAC, no controller, no read endpoint — Phase 1 is capture-only, matching Audit's own precedent (it has no controller at all). Read/query access is explicitly Phase 6 scope.

---

## Task 1: ReportingEvent entity and migration

**Files:**
- Create: `apps/api/src/reporting/entities/reporting-event.entity.ts`
- Create: `apps/api/src/database/migrations/0017-create-reporting-events-table.ts`
- Test: `apps/api/src/reporting/reporting-events.integration-spec.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: the `ReportingEvent` TypeORM entity (table `reporting_events`), which Task 2's publisher and subscriber depend on.

- [ ] **Step 1: Write the entity**

Create `apps/api/src/reporting/entities/reporting-event.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AuditExcludeEntity } from '@hospital/audit-emitter';

@Entity('reporting_events')
@AuditExcludeEntity()
export class ReportingEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 50 })
  eventType!: string;

  @Column({ type: 'uuid' })
  entityId!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  correlationId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 2: Write the migration**

Create `apps/api/src/database/migrations/0017-create-reporting-events-table.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReportingEventsTable0017 implements MigrationInterface {
  name = 'CreateReportingEventsTable0017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE reporting_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "eventType" varchar(50) NOT NULL,
        "entityId" uuid NOT NULL,
        payload jsonb NOT NULL,
        "occurredAt" timestamptz NOT NULL,
        "correlationId" varchar NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_reporting_events_event_type" ON reporting_events ("eventType")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE reporting_events`);
  }
}
```

- [ ] **Step 3: Register the migration and entity in `data-source.ts`**

In `apps/api/src/database/data-source.ts`, add these imports near the other entity/migration imports:

```typescript
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { CreateReportingEventsTable0017 } from './migrations/0017-create-reporting-events-table.js';
```

Add `ReportingEvent` to the end of the `entities` array, and `CreateReportingEventsTable0017` to the end of the `migrations` array (both currently end with `..., Payment, Deposit]` and `..., CreateBillingTables0016]` respectively).

- [ ] **Step 4: Register the migration invocation in `accounts.service.ts`**

In `apps/api/src/accounts/accounts.service.ts`, add this import near the other migration imports:

```typescript
import { CreateReportingEventsTable0017 } from '../database/migrations/0017-create-reporting-events-table.js';
```

Immediately after the existing `billingMigration.up(queryRunner);` line (inside `provisionTenantSchema`, before the `} finally {`), add:

```typescript
      const reportingMigration = new CreateReportingEventsTable0017();
      await reportingMigration.up(queryRunner);
```

- [ ] **Step 5: Write the verification test**

Create `apps/api/src/reporting/reporting-events.integration-spec.ts`:

```typescript
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';

describe('ReportingEvent migration (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let tenantId: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);

    const uniqueId = Date.now().toString();
    const tenant = await tenantsService.provisionTenant({
      hospitalId: `reporting_events_${uniqueId}`,
      hospitalName: 'Reporting Events Hospital',
    });
    tenantId = tenant.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  it('creates the reporting_events table, queryable and empty', async () => {
    await inTenant(async () => {
      await tenantConnection.runInTenantSchema(async (manager) => {
        expect(await manager.getRepository(ReportingEvent).count()).toBe(0);
      });
    });
  });
});
```

- [ ] **Step 6: Run typecheck and the new test**

Run: `pnpm exec nx run-many -t typecheck test --skip-nx-cache` (from `new/code`)
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/reporting/entities apps/api/src/reporting/reporting-events.integration-spec.ts apps/api/src/database/migrations/0017-create-reporting-events-table.ts apps/api/src/database/data-source.ts apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add ReportingEvent entity and migration"
```

---

## Task 2: ReportingSubscriber, publisher, and wiring

**Files:**
- Create: `apps/api/src/reporting/reporting-event-publisher.interface.ts`
- Create: `apps/api/src/reporting/persisting-reporting-event-publisher.ts`
- Create: `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`
- Create: `apps/api/src/reporting/reporting.subscriber.ts`
- Create: `apps/api/src/reporting/reporting.subscriber.integration-spec.ts`
- Create: `apps/api/src/reporting/reporting-wiring.service.ts`
- Create: `apps/api/src/reporting/reporting.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `ReportingEvent` entity (Task 1); `Order` (`apps/api/src/orders/entities/order.entity.js`), `Invoice`/`Payment`/`Deposit` (`apps/api/src/billing/entities/*.js`), `Admission`/`BedTransfer` (`apps/api/src/admissions/entities/*.js`) — all pre-existing entities from earlier modules.
- Produces: `ReportingEventPublisher` interface + `REPORTING_EVENT_PUBLISHER` DI token, `PersistingReportingEventPublisher`, `ReportingSubscriber`, `ReportingModule` (registered into `AppModule`). Nothing later in this plan depends on these, since this is the final task.

- [ ] **Step 1: Write the publisher interface**

Create `apps/api/src/reporting/reporting-event-publisher.interface.ts`:

```typescript
import type { EntityManager } from 'typeorm';

export interface ReportingEventRecord {
  eventType: string;
  entityId: string;
  payload: Record<string, unknown>;
  correlationId?: string;
  occurredAt: string;
}

export interface ReportingEventPublisher {
  publish(event: ReportingEventRecord, manager?: EntityManager): Promise<void>;
}

export const REPORTING_EVENT_PUBLISHER = Symbol('REPORTING_EVENT_PUBLISHER');
```

- [ ] **Step 2: Write the failing publisher test**

Create `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`:

```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';

describe('PersistingReportingEventPublisher (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const publisher = new PersistingReportingEventPublisher(tenantConnection);

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, 'test_reporting_persist');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_reporting_persist" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_reporting_persist', correlationId: 'test-correlation' }, work);
  }

  it('persists a reporting event into the current tenant schema', async () => {
    await inTenant(() =>
      publisher.publish({
        eventType: 'OrderPlaced',
        entityId: '11111111-1111-1111-1111-111111111111',
        payload: { orderId: '11111111-1111-1111-1111-111111111111', patientId: '22222222-2222-2222-2222-222222222222' },
        correlationId: 'test-correlation',
        occurredAt: new Date().toISOString(),
      }),
    );

    const events = await inTenant(() =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(ReportingEvent).find({ where: { eventType: 'OrderPlaced' } }),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe('11111111-1111-1111-1111-111111111111');
    expect(events[0].correlationId).toBe('test-correlation');
    expect(events[0].payload).toEqual({
      orderId: '11111111-1111-1111-1111-111111111111',
      patientId: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('swallows and logs a persist failure instead of throwing (no tenant context set)', async () => {
    await expect(
      publisher.publish({
        eventType: 'OrderPlaced',
        entityId: 'x',
        payload: {},
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec nx run api:test --skip-nx-cache -- --testPathPatterns=persisting-reporting-event-publisher` (from `new/code`)
Expected: FAIL — `persisting-reporting-event-publisher.js` does not exist yet.

- [ ] **Step 4: Write the publisher**

Create `apps/api/src/reporting/persisting-reporting-event-publisher.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { ReportingEventPublisher, ReportingEventRecord } from './reporting-event-publisher.interface.js';

@Injectable()
export class PersistingReportingEventPublisher implements ReportingEventPublisher {
  private readonly logger = new Logger(PersistingReportingEventPublisher.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async publish(event: ReportingEventRecord, manager?: EntityManager): Promise<void> {
    try {
      if (manager) {
        await manager.getRepository(ReportingEvent).save(this.buildRecord(manager, event));
        return;
      }
      await this.tenantConnection.runInTenantSchema((m) =>
        m.getRepository(ReportingEvent).save(this.buildRecord(m, event)),
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist reporting event for ${event.eventType}/${event.entityId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private buildRecord(manager: EntityManager, event: ReportingEventRecord): ReportingEvent {
    return manager.getRepository(ReportingEvent).create({
      eventType: event.eventType,
      entityId: event.entityId,
      payload: event.payload,
      correlationId: event.correlationId ?? null,
      occurredAt: new Date(event.occurredAt),
    });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec nx run api:test --skip-nx-cache -- --testPathPatterns=persisting-reporting-event-publisher` (from `new/code`)
Expected: PASS

- [ ] **Step 6: Write the failing subscriber test**

Create `apps/api/src/reporting/reporting.subscriber.integration-spec.ts`:

```typescript
import { ConflictException } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { DepositsService } from '../billing/deposits.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';

describe('ReportingSubscriber (integration)', () => {
  const dataSource = createDataSource();
  let tenantContextService: TenantContextService;
  let tenantConnection: TenantConnectionService;
  let patientsService: PatientsService;
  let masterDataService: MasterDataService;
  let ordersService: OrdersService;
  let invoicesService: InvoicesService;
  let depositsService: DepositsService;
  let admissionsService: AdmissionsService;

  let tenantId1: string;
  let tenantId2: string;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000f1';
  const DOCTOR_ID = '00000000-0000-0000-0000-0000000000d1';

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);
    const patientSequence = new PatientNumberGeneratorService(tenantConnection);
    patientsService = new PatientsService(tenantConnection, patientSequence);
    masterDataService = new MasterDataService(tenantConnection);
    ordersService = new OrdersService(tenantConnection);
    invoicesService = new InvoicesService(tenantConnection);
    depositsService = new DepositsService(tenantConnection);
    admissionsService = new AdmissionsService(tenantConnection);

    const publisher = new PersistingReportingEventPublisher(tenantConnection);
    const subscriber = new ReportingSubscriber(publisher, tenantContextService);
    dataSource.subscribers.push(subscriber);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `reporting_sub_1_${uniqueId}`, hospitalName: 'Reporting Sub Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `reporting_sub_2_${uniqueId}`, hospitalName: 'Reporting Sub Hospital 2' });
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
    const ward = await inTenant(tenantId, async () => {
      try {
        return await masterDataService.createWard({ wardCode, wardName: wardCode });
      } catch (error) {
        if (error instanceof ConflictException) {
          const wards = await masterDataService.listWards();
          const existing = wards.find((w) => w.wardCode === wardCode);
          if (existing) {
            return existing;
          }
        }
        throw error;
      }
    });
    return inTenant(tenantId, () => masterDataService.createBed({ wardId: ward.id, bedNumber }));
  }

  async function eventsFor(tenantId: string, eventType: string): Promise<ReportingEvent[]> {
    return inTenant(tenantId, () =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(ReportingEvent).find({ where: { eventType } }),
      ),
    );
  }

  it('emits OrderPlaced when an order is created', async () => {
    const patient = await makePatient(tenantId1, '7770000001');
    const order = await inTenant(tenantId1, () =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    const events = await eventsFor(tenantId1, 'OrderPlaced');
    const match = events.find((e) => e.entityId === order.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({ orderId: order.id, patientId: patient.id, orderedBy: DOCTOR_ID });
  });

  it('emits InvoiceCreated when an invoice is created', async () => {
    const patient = await makePatient(tenantId1, '7770000002');
    const invoice = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Consultation Fee', unitPrice: 500 }] }),
    );

    const events = await eventsFor(tenantId1, 'InvoiceCreated');
    const match = events.find((e) => e.entityId === invoice.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({
      invoiceId: invoice.id,
      patientId: patient.id,
      invoiceNumber: invoice.invoiceNumber,
      financialYear: invoice.financialYear,
      totalAmount: invoice.totalAmount,
    });
  });

  it('emits PaymentRecorded when a payment is recorded', async () => {
    const patient = await makePatient(tenantId1, '7770000003');
    const invoice = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Consultation Fee', unitPrice: 500 }] }),
    );
    const payment = await inTenant(tenantId1, () =>
      invoicesService.recordPayment(invoice.id, { amount: 500, paymentMode: 'Cash', receivedBy: STAFF_ID }),
    );

    const events = await eventsFor(tenantId1, 'PaymentRecorded');
    const match = events.find((e) => e.entityId === payment.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({ paymentId: payment.id, invoiceId: invoice.id, amount: 500, paymentMode: 'Cash' });
  });

  it('emits DepositReceived when a deposit is created', async () => {
    const patient = await makePatient(tenantId1, '7770000004');
    const deposit = await inTenant(tenantId1, () =>
      depositsService.create({ patientId: patient.id, amount: 2000, receivedBy: STAFF_ID }),
    );

    const events = await eventsFor(tenantId1, 'DepositReceived');
    const match = events.find((e) => e.entityId === deposit.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({ depositId: deposit.id, patientId: patient.id, amount: 2000 });
  });

  it('emits PatientAdmitted when a patient is admitted', async () => {
    const patient = await makePatient(tenantId1, '7770000005');
    const bed = await makeBed(tenantId1, 'REPORT-WARD-1');
    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bed.id }),
    );

    const events = await eventsFor(tenantId1, 'PatientAdmitted');
    const match = events.find((e) => e.entityId === admission.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({
      admissionId: admission.id,
      patientId: patient.id,
      wardId: bed.wardId,
      bedId: bed.id,
      admissionSource: 'Direct',
    });
  });

  it('emits BedTransferred when a patient is transferred to another bed', async () => {
    // Note: admissionsService.admit() itself inserts a BedTransfer row (fromBedId: null,
    // "Initial admission") as part of admitting, so this test disambiguates by toBedId
    // rather than admissionId alone — both the initial-admission transfer and the explicit
    // transfer() call below produce BedTransfer rows for the same admissionId.
    const patient = await makePatient(tenantId1, '7770000006');
    const bedA = await makeBed(tenantId1, 'REPORT-WARD-2', '1');
    const bedB = await makeBed(tenantId1, 'REPORT-WARD-2', '2');
    const admission = await inTenant(tenantId1, () =>
      admissionsService.admit({ patientId: patient.id, admissionSource: 'Direct', admittingDoctorId: DOCTOR_ID, bedId: bedA.id }),
    );
    await inTenant(tenantId1, () => admissionsService.transfer(admission.id, { toBedId: bedB.id, transferredBy: DOCTOR_ID }));

    const events = await eventsFor(tenantId1, 'BedTransferred');
    expect(events.length).toBeGreaterThanOrEqual(2);
    const match = events.find((e) => (e.payload as { toBedId: string }).toBedId === bedB.id);
    expect(match).toBeDefined();
    expect(match!.payload).toEqual({
      bedTransferId: match!.entityId,
      admissionId: admission.id,
      fromBedId: bedA.id,
      toBedId: bedB.id,
    });

    const initialAdmitTransfer = events.find((e) => (e.payload as { toBedId: string }).toBedId === bedA.id);
    expect(initialAdmitTransfer).toBeDefined();
    expect(initialAdmitTransfer!.payload).toEqual({
      bedTransferId: initialAdmitTransfer!.entityId,
      admissionId: admission.id,
      fromBedId: null,
      toBedId: bedA.id,
    });
  });

  it('does not emit any event for an entity outside the reportable map', async () => {
    await makePatient(tenantId1, '7770000007');
    const events = await inTenant(tenantId1, () =>
      tenantConnection.runInTenantSchema((manager) => manager.getRepository(ReportingEvent).find()),
    );
    expect(events.every((e) => e.eventType !== 'PatientCreated')).toBe(true);
  });

  it('enforces tenant isolation for reporting events', async () => {
    const patient = await makePatient(tenantId1, '7770000008');
    const order = await inTenant(tenantId1, () =>
      ordersService.create({ patientId: patient.id, orderedBy: DOCTOR_ID, items: [{ itemType: 'Lab', itemDescription: 'CBC' }] }),
    );

    const tenant2Events = await eventsFor(tenantId2, 'OrderPlaced');
    expect(tenant2Events.find((e) => e.entityId === order.id)).toBeUndefined();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm exec nx run api:test --skip-nx-cache -- --testPathPatterns=reporting.subscriber` (from `new/code`)
Expected: FAIL — `reporting.subscriber.js` does not exist yet.

- [ ] **Step 8: Write the subscriber**

Create `apps/api/src/reporting/reporting.subscriber.ts`:

```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { EntitySubscriberInterface, EventSubscriber, InsertEvent } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { REPORTING_EVENT_PUBLISHER } from './reporting-event-publisher.interface.js';
import type { ReportingEventPublisher } from './reporting-event-publisher.interface.js';
import { Order } from '../orders/entities/order.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { Payment } from '../billing/entities/payment.entity.js';
import { Deposit } from '../billing/entities/deposit.entity.js';
import { Admission } from '../admissions/entities/admission.entity.js';
import { BedTransfer } from '../admissions/entities/bed-transfer.entity.js';

interface ReportableEntityConfig {
  eventType: string;
  buildPayload: (entity: Record<string, unknown>) => Record<string, unknown>;
}

const REPORTABLE_ENTITIES = new Map<Function, ReportableEntityConfig>([
  [
    Order,
    {
      eventType: 'OrderPlaced',
      buildPayload: (entity) => ({
        orderId: entity['id'],
        patientId: entity['patientId'],
        orderedBy: entity['orderedBy'],
      }),
    },
  ],
  [
    Invoice,
    {
      eventType: 'InvoiceCreated',
      buildPayload: (entity) => ({
        invoiceId: entity['id'],
        patientId: entity['patientId'],
        invoiceNumber: entity['invoiceNumber'],
        financialYear: entity['financialYear'],
        totalAmount: entity['totalAmount'],
      }),
    },
  ],
  [
    Payment,
    {
      eventType: 'PaymentRecorded',
      buildPayload: (entity) => ({
        paymentId: entity['id'],
        invoiceId: entity['invoiceId'],
        amount: entity['amount'],
        paymentMode: entity['paymentMode'],
      }),
    },
  ],
  [
    Deposit,
    {
      eventType: 'DepositReceived',
      buildPayload: (entity) => ({
        depositId: entity['id'],
        patientId: entity['patientId'],
        amount: entity['amount'],
      }),
    },
  ],
  [
    Admission,
    {
      eventType: 'PatientAdmitted',
      buildPayload: (entity) => ({
        admissionId: entity['id'],
        patientId: entity['patientId'],
        wardId: entity['wardId'],
        bedId: entity['bedId'],
        admissionSource: entity['admissionSource'],
      }),
    },
  ],
  [
    BedTransfer,
    {
      eventType: 'BedTransferred',
      buildPayload: (entity) => ({
        bedTransferId: entity['id'],
        admissionId: entity['admissionId'],
        fromBedId: entity['fromBedId'],
        toBedId: entity['toBedId'],
      }),
    },
  ],
]);

@EventSubscriber()
@Injectable()
export class ReportingSubscriber implements EntitySubscriberInterface {
  private readonly logger = new Logger(ReportingSubscriber.name);

  constructor(
    @Inject(REPORTING_EVENT_PUBLISHER)
    private readonly publisher: ReportingEventPublisher,
    private readonly tenantContext: TenantContextService,
  ) {}

  async afterInsert(event: InsertEvent<Record<string, unknown>>): Promise<void> {
    const entityClass = event.entity?.constructor;
    if (!entityClass) {
      return;
    }
    const config = REPORTABLE_ENTITIES.get(entityClass);
    if (!config) {
      return;
    }

    await this.publisher.publish(
      {
        eventType: config.eventType,
        entityId: String(event.entity?.['id'] ?? ''),
        payload: config.buildPayload(event.entity as Record<string, unknown>),
        correlationId: this.tenantContext.getCorrelationId(),
        occurredAt: new Date().toISOString(),
      },
      event.manager,
    );
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm exec nx run api:test --skip-nx-cache -- --testPathPatterns=reporting.subscriber` (from `new/code`)
Expected: PASS

- [ ] **Step 10: Write the wiring service, module, and app wiring**

Create `apps/api/src/reporting/reporting-wiring.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReportingSubscriber } from './reporting.subscriber.js';

@Injectable()
export class ReportingWiringService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reportingSubscriber: ReportingSubscriber,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this.reportingSubscriber);
  }
}
```

Create `apps/api/src/reporting/reporting.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { REPORTING_EVENT_PUBLISHER } from './reporting-event-publisher.interface.js';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { ReportingWiringService } from './reporting-wiring.service.js';

@Global()
@Module({
  imports: [TenantContextModule, DatabaseModule],
  providers: [
    { provide: REPORTING_EVENT_PUBLISHER, useClass: PersistingReportingEventPublisher },
    ReportingSubscriber,
    ReportingWiringService,
  ],
  exports: [REPORTING_EVENT_PUBLISHER, ReportingSubscriber],
})
export class ReportingModule {}
```

In `apps/api/src/app/app.module.ts`, add this import near the other module imports:

```typescript
import { ReportingModule } from '../reporting/reporting.module.js';
```

Add `ReportingModule` to the end of the `imports` array (after `BillingModule`).

- [ ] **Step 11: Run all tests**

Run: `pnpm exec nx run-many -t typecheck test --skip-nx-cache` (from `new/code`)
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/reporting/reporting-event-publisher.interface.ts apps/api/src/reporting/persisting-reporting-event-publisher.ts apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts apps/api/src/reporting/reporting.subscriber.ts apps/api/src/reporting/reporting.subscriber.integration-spec.ts apps/api/src/reporting/reporting-wiring.service.ts apps/api/src/reporting/reporting.module.ts apps/api/src/app/app.module.ts
git commit -m "feat: add ReportingSubscriber, publisher, and wiring"
```
