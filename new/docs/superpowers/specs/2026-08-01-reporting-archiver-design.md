# Reporting/Dashboard Event Archiver — Design Specification

## Overview

This module introduces the Reporting/Dashboard module's Phase 1 slice — the event archiver only, per the PRD's phasing (§8): "the archiver ships alongside these [Order/Billing/ADT] because Order/Billing/ADT start generating auditable events immediately — without a consumer live from Phase 1, that history is unrecoverable by the time the full dashboard ships in Phase 6." The full aggregation/dashboard UI is explicitly out of scope until Phase 6, which will read the archive this module builds up from Phase 1 onward — no backfill gap.

The codebase already has an in-process TypeORM subscriber mechanism — `@hospital/audit-emitter`'s `AuditSubscriber` — which the existing Audit module uses to capture generic before/after field diffs for every entity, for compliance ("who changed what"). This archiver is architecturally similar (in-process subscriber, not a message bus, per the PRD's explicit instruction) but serves a different purpose: capturing a small, curated set of **semantic business events** ("an invoice was created," "a patient was admitted") with purpose-built payloads, not raw field diffs. A reporting/analytics consumer needs domain-meaningful facts, not generic CRUD noise — building revenue or admissions reporting from Audit's diff log would be lossy and awkward.

**Scope for Phase 1:** insert-only events. Every event captured here corresponds to a brand-new row being created — never a state transition on an existing row. Deriving "this update means X" safely and generically from a subscriber is the fragile part of this design; scoping it out for now is a deliberate, stated limitation, not a silent gap — consistent with how every other Phase 1 module in this project has been kept deliberately thin.

## Architecture & Data Flow

New `ReportingModule` (`apps/api/src/reporting/`), structurally parallel to the existing `AuditModule` (`apps/api/src/audit/`) — same in-process TypeORM-subscriber mechanism, same tenant-scoped table pattern, same fire-and-forget resilience (a failed event write never breaks the underlying business transaction that triggered it).

It differs from Audit in one key way: Audit's `AuditSubscriber` is **opt-out** — it covers every entity by default, excluding only those marked with `@AuditExclude`. `ReportingSubscriber` is **opt-in** — it holds a small static map of `EntityClass → { eventType, buildPayload(entity) }` for exactly six entities, and silently ignores everything else. This is a deliberate architectural choice: the whole point of this module is a curated, small, meaningful event catalog, not blanket coverage.

`ReportingSubscriber`'s payload-builders need to import entity classes from three different domain modules (`orders/`, `billing/`, `admissions/`). Audit's subscriber lives in a separate, reusable `libs/audit-emitter` Nx library and works generically (via `tableName`/TypeORM metadata, no entity imports) — that pattern doesn't fit here, since typed payload-building needs the actual entity classes, which only exist inside `apps/api`. `ReportingSubscriber` therefore lives directly in `apps/api/src/reporting/`, not a new shared library. This matches the already-established convention of importing entity classes across domain modules within the same app (e.g. `InvoicesService` already imports `Patient` directly).

## Event Catalog

| Event | Source entity | Payload |
|---|---|---|
| `OrderPlaced` | `Order` | `orderId`, `patientId`, `orderedBy`, `itemCount`, `itemTypes` (string[], from the order's items at insert time) |
| `InvoiceCreated` | `Invoice` | `invoiceId`, `patientId`, `invoiceNumber`, `financialYear`, `totalAmount` |
| `PaymentRecorded` | `Payment` | `paymentId`, `invoiceId`, `amount`, `paymentMode` |
| `DepositReceived` | `Deposit` | `depositId`, `patientId`, `amount` |
| `PatientAdmitted` | `Admission` | `admissionId`, `patientId`, `wardId`, `bedId`, `admissionSource` |
| `BedTransferred` | `BedTransfer` | `bedTransferId`, `admissionId`, `fromBedId`, `toBedId` |

**Deferred** (update-derived, needs a future design pass once the insert-only pattern has proven itself): `InvoicePaid`/`InvoicePartiallyPaid` (status transitions on `Invoice`), `InvoiceCancelled`, `DepositRefunded`, `PatientDischarged` (status transition on `Admission`), `OrderItemCompleted`/`OrderItemCancelled` (status transitions on `OrderItem`).

Since `Order`'s items are inserted in the same batch as the order header (see `OrdersService.create`), `OrderPlaced`'s `itemCount`/`itemTypes` are derived from the `InsertEvent`'s entity if items are eagerly available, or from a follow-up query scoped to the same transaction — implementation detail resolved at plan-writing time, not a design-level ambiguity.

## Data Model

### `ReportingEvent` (table: `reporting_events`, tenant-scoped, mirrors `AuditRecord`)

- `id`: UUID (Primary Key)
- `eventType`: varchar — one of the six event types above
- `entityId`: UUID — the id of the row that triggered this event
- `payload`: jsonb — the event-specific fields from the catalog above
- `occurredAt`: timestamptz
- `correlationId`: varchar, nullable (from `TenantContextService`, matching `AuditRecord`'s pattern)

No `hospitalId` column — the table lives inside the tenant's own schema (created via `provisionTenantSchema`, same as every other tenant-scoped table in this codebase), so tenancy is implicit, matching `AuditRecord`'s precedent exactly.

## RBAC & Security

None. Phase 1 is capture-only — no read/query endpoint exists yet (matching Audit's own precedent: it has no controller at all). RBAC for reading the archive is a Phase 6 concern, once the aggregation/dashboard layer that actually exposes it is built.

## Error Handling

- `ReportingSubscriber.afterInsert` never throws — an unrecognized entity class (the vast majority of inserts: `Patient`, `Vital`, `AuditRecord`, etc.) is silently skipped, no logging noise.
- `PersistingReportingEventPublisher.publish` wraps its write in try/catch, logging on failure and swallowing the error — a failed reporting-archive write must never roll back or block the real business transaction that triggered it, identical resilience contract to `PersistingAuditEventPublisher`.
- A `buildPayload` failure (e.g. an unexpected null field) is caught and logged the same way, never propagated.

## Testing

Integration tests against real Postgres, tenant-scoped, following the established pattern (see `audit/persisting-audit-event-publisher.integration-spec.ts`):

- For each of the six entities, perform the real service-level action (e.g. `invoicesService.create(...)`, `depositsService.create(...)`, `admissionsService.admit(...)`) and assert a `ReportingEvent` row was written with the correct `eventType`, `entityId`, and payload fields — exercising the subscriber exactly as production traffic would, not testing it in isolation.
- One test confirming an entity NOT in the map (e.g. creating a `Patient` or `Vital`) does not produce a `ReportingEvent` row — locks in the opt-in/allowlist behavior against regressing toward Audit's blanket-coverage model.
- One test confirming tenant isolation — events created in tenant A are not visible when querying tenant B's schema.
- No controller tests — no controller exists in Phase 1.

## Self-Review Notes

- **Placeholder scan:** No missing/TBD details, beyond the one explicitly-deferred implementation detail (how `OrderPlaced`'s item list is sourced), which is scoped as a plan-writing decision, not a design ambiguity.
- **Internal consistency:** The insert-only scope is stated once and applied consistently across the event catalog — no event implies an update-derived transition.
- **Scope check:** Deliberately excludes any read/query API, aggregation logic, or dashboard UI (Phase 6 per the PRD's phasing table, §8). Deliberately excludes update-derived events as a named, honest limitation.
- **Ambiguity check:** "Opt-in allowlist, not opt-out blanket" is stated as a hard architectural choice distinguishing this module from Audit, so a future extension doesn't silently regress it toward blanket coverage.
