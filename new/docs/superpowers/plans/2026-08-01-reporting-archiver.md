# Reporting Event Archiver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a reporting event archiver that captures semantic business events (Orders, Invoices, Admissions, etc.) into a tenant-scoped database table using a TypeORM subscriber.

**Architecture:** A new `ReportingModule` in `apps/api/src/reporting/` containing a `ReportingEvent` entity, a `ReportingSubscriber` that intercepts inserts for 6 specific entities, and a `PersistingReportingEventPublisher` that saves events safely without breaking the main business transaction. 

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest.

## Global Constraints

- Scope for Phase 1: insert-only events.
- In-process TypeORM subscriber, not a message bus.
- ReportingSubscriber is opt-in (holds a small static map for exactly six entities).
- No read/query endpoint exists yet (no controller).
- Failed reporting-archive write must never roll back or block the real business transaction.
- `afterInsert` fires on an entity's own row before any of its child rows are saved in the same
  service method (e.g. `Order`'s row exists before `OrdersService` saves its `OrderItem` rows) —
  payload builders can only use columns native to the inserted row itself, never a same-transaction
  child-table query.
- `ReportingEvent` is a system-generated audit-adjacent table, not a business record — it must be
  excluded from the Audit subscriber's blanket coverage, matching `AuditRecord`'s own precedent.
- A new tenant-scoped table (`reporting_events`) needs a paired TypeORM migration, and that
  migration must be registered wherever this codebase's migration list lives so it actually reaches
  every tenant schema — an entity with no registered migration has no backing table, and every
  insert against it fails silently (swallowed by the publisher's own try/catch).

---

### Task 1: Entity & Module Setup

**Files:**
- Create: `apps/api/src/reporting/entities/reporting-event.entity.ts`
- Create: `apps/api/src/reporting/reporting.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Produces: `ReportingEvent` entity class, `ReportingModule`

- [ ] **Step 1: Write the ReportingEvent entity**
Create `reporting-event.entity.ts` with fields: `id` (uuid), `eventType` (varchar), `entityId` (uuid), `payload` (jsonb), `occurredAt` (timestamptz, defaulting to `CURRENT_TIMESTAMP`), `correlationId` (varchar, nullable), and `createdAt` (`@CreateDateColumn`, timestamptz). Use `@Entity('reporting_events')`. No hospitalId column. Apply `@AuditExcludeEntity()` (from `@hospital/audit-emitter`) on the class — matching `AuditRecord`'s own precedent — so the Audit subscriber's blanket coverage doesn't also generate an `AuditRecord` row for every reporting event.

- [ ] **Step 2: Write the ReportingModule**
Create `reporting.module.ts` that imports `TypeOrmModule.forFeature([ReportingEvent])`.

- [ ] **Step 3: Register in AppModule**
Add `ReportingModule` to the `imports` array in `app.module.ts`.

- [ ] **Step 4: Create and register the migration**
Create a TypeORM migration for the `reporting_events` table and register it wherever this
codebase's tenant-schema migration list lives (at the time of this task, that's the shared
migrations array `data-source.ts` uses; check the current codebase for whatever that mechanism has
since evolved into). Skipping this step means the entity has no backing table in any tenant
schema, and every insert against it fails silently — the publisher's own try/catch swallows the
error, so there is no visible symptom besides "no rows ever appear."

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/reporting apps/api/src/app/app.module.ts apps/api/src/database
git commit -m "feat(reporting): add ReportingEvent entity and module"
```

### Task 2: Persisting Publisher

**Files:**
- Create: `apps/api/src/reporting/persisting-reporting-event-publisher.ts`
- Modify: `apps/api/src/reporting/reporting.module.ts`

**Interfaces:**
- Consumes: `ReportingEvent` entity
- Produces: `PersistingReportingEventPublisher` class

- [ ] **Step 1: Write the Publisher**
Create `persisting-reporting-event-publisher.ts`. Inject `DataSource` or `Repository<ReportingEvent>`. Implement a `publish(eventData: Partial<ReportingEvent>)` method. Wrap the save operation in a `try/catch` block. Log errors but do not throw them.

- [ ] **Step 2: Register Provider**
Add `PersistingReportingEventPublisher` to the `providers` and `exports` array in `ReportingModule`.

- [ ] **Step 3: Commit**
```bash
git add apps/api/src/reporting
git commit -m "feat(reporting): add persisting event publisher"
```

### Task 3: Reporting Subscriber

**Files:**
- Create: `apps/api/src/reporting/reporting.subscriber.ts`
- Modify: `apps/api/src/reporting/reporting.module.ts`

**Interfaces:**
- Consumes: `PersistingReportingEventPublisher`, `TenantContextService`
- Produces: `ReportingSubscriber`

- [ ] **Step 1: Write the Subscriber structure**
Create `reporting.subscriber.ts` implementing `EntitySubscriberInterface`. In constructor, inject `PersistingReportingEventPublisher`, `TenantContextService`, and `DataSource`. Call `dataSource.subscribers.push(this)`.

- [ ] **Step 2: Implement the mapping map**
Define a static map or configuration mapping the 6 entities (`Order`, `Invoice`, `Payment`, `Deposit`, `Admission`, `BedTransfer`) to their respective `eventType` strings and a `buildPayload(entity, event)` function.
- For `OrderPlaced`: map only columns native to the `Order` row itself — `orderId`, `patientId`,
  `orderedBy`, `sourceAppointmentId`, `sourceAdmissionId`. **Do not** query `OrderItem` here:
  `OrdersService` saves `OrderItem` rows after the `Order` row, in the same request, so at
  `afterInsert` time on `Order` no `OrderItem` rows exist yet to query — an `itemCount`/`itemTypes`
  field built this way would always read as zero/empty.
- For `InvoiceCreated`: map `invoiceNumber`, `financialYear`, `totalAmount`, etc.
- For `PaymentRecorded`: map `amount`, `paymentMode`, `invoiceId`.
- For `DepositReceived`: map `amount`, `patientId`.
- For `PatientAdmitted`: map `wardId`, `bedId`, `admissionSource`.
- For `BedTransferred`: map `fromBedId`, `toBedId`, `admissionId`.

- [ ] **Step 3: Implement afterInsert**
In `afterInsert(event: InsertEvent<any>)`, look up the map using `event.metadata.target` (the
entity's class, as TypeORM resolves it from the insert's own metadata) as the key — not
`event.entity` or an `instanceof`/constructor check against `event.entity`, which is unreliable
across every insert path (e.g. certain `QueryBuilder` raw inserts don't hand back a full class
instance as `event.entity`, but `event.metadata.target` is always the mapped entity class). If
`event.metadata.target` isn't a function, or there's no map entry for it, return early. Otherwise
run `buildPayload` inside a `try/catch`. Build a `ReportingEvent` object including `correlationId`
from `TenantContextService.getCorrelationId()`. Pass to `publisher.publish()`.

- [ ] **Step 4: Register in Module**
Add `ReportingSubscriber` to the `providers` array in `ReportingModule`.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/reporting
git commit -m "feat(reporting): add reporting subscriber for business events"
```

### Task 4: Integration Tests

**Files:**
- Create: `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`

**Interfaces:**
- Consumes: `ReportingModule`, domain services (Orders, Billing, Admissions)

- [ ] **Step 1: Setup Test Bed**
Create the integration spec. Setup a Nest app with a test postgres container (similar to other integration tests). Provide the necessary modules (`TypeOrmModule`, domain modules).

- [ ] **Step 2: Write tests for all 6 events**
Write an `it()` block that runs a real service method for each of the 6 tracked actions (e.g. `admissionsService.admit()`, `invoicesService.create()`). Query the `reporting_events` table and `expect()` that the event was created with the correct `eventType` and payload.

- [ ] **Step 3: Write test for unmapped entities**
Write an `it()` block that creates a `Patient`. Query `reporting_events` and `expect` no event to be created.

- [ ] **Step 4: Write test for tenant isolation**
Write an `it()` block that creates an event for `tenant_1` and verifies it cannot be seen when querying `tenant_2`'s schema.

- [ ] **Step 5: Run tests and commit**
Run `npx nx test api --testFile persisting-reporting-event-publisher.integration-spec.ts`.
```bash
git add apps/api/src/reporting
git commit -m "test(reporting): add integration tests for reporting archiver"
```
