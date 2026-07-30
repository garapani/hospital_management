# Audit Service — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §7, §8 Phase 0, §10)
**Old-system source (field inspiration only — mechanism differs significantly, see below):** `old/hospital-management-emr/Code/Components/DanpheEMR.ServerModel/SystemAdminModels/AuditTrailModel.cs`, `SqlAuditModel.cs`; `Audit.EntityFramework`/`Audit.NET.SqlServer` deps

## Mechanism mismatch with the old system

Two old audit mechanisms exist, and neither ports directly:

- `SqlAuditModel` is SQL Server's native statement-level audit log — engine-specific infrastructure, no Postgres equivalent, not portable at all.
- `AuditTrailModel` is populated by an EF `SaveChanges` interceptor (`Audit.EntityFramework`) that captures **every table's every column change automatically**, blanket coverage with zero per-entity developer effort.

The new Audit Service (PRD §5.1/§7) is event-driven by design — it only sees what a service publishes to RabbitMQ. That's a materially different guarantee than the old interceptor's blanket coverage: relying solely on business-meaningful domain events (order placed, bill settled, etc.) would silently drop audit coverage for routine edits with no corresponding named event (e.g. a nurse correcting a patient's phone number). Given the compliance stakes (DPDP, hospital accreditation), this repo's decision is to **restore blanket coverage via a shared library, not per-service discipline**: every mutating write publishes a generic `record.changed` event automatically, on top of whatever meaningful domain events a service already publishes for its own reasons.

## Scope

Centralized, append-only audit trail. Consumes both the generic `record.changed` event and every named domain event already flowing through RabbitMQ (order placed, bill settled, `rbac.changed`, `tenant.provisioned`, etc., per PRD §7). Phase 0 service — needs to exist before other Phase 0/1 services start generating events worth capturing.

## New shared library: `@hospital/audit-emitter`

A NestJS/TypeORM interceptor, imported by every service (same pattern as the already-decided `@hospital/tenant-context` and `@hospital/auth-guards`, PRD §4/§6.2 — a cross-cutting concern implemented once, not reimplemented per service). Hooks into TypeORM's insert/update/delete lifecycle and publishes `record.changed {tableName, recordId, action, changedByAccountId, hospitalId, correlationId, diff, occurredAt}` for every mutating write, without requiring each developer to manually instrument it.

**Sensitive-field exclusion is mandatory, not optional:** fields such as `password_hash`, OTP codes, and refresh-token hashes must never appear in a captured diff — an audit log that stores credential material becomes a second leak surface. Sensitive fields are marked with a decorator (e.g. `@AuditExclude()`) that `@hospital/audit-emitter` respects; excluded fields are omitted from the diff entirely, not merely masked.

## Data model

Tenant-scoped (`tenant_<hospitalId>`, same pattern as most other services — Auditor/Compliance role is single-hospital per PRD §6.1; Super Admin's existing cross-tenant schema-switching mechanism, already established in the Identity & Access design, covers vendor-side cross-tenant review).

| Table | Key fields |
|---|---|
| `audit_records` | audit_id, occurred_at, service_name, event_type (`record.changed` or a named domain event type), table_name, record_id, action (create\|update\|delete), changed_by_account_id, changed_by_display_name (denormalized at write time — doesn't change retroactively if the account is later renamed), correlation_id, diff (jsonb) |

`correlation_id` is carried through from the originating request/saga (PRD §11's saga/outbox pattern) so a cross-service workflow (e.g. Order fulfilled → Billing charge created) can be reconstructed as one trail during debugging or a compliance inquiry, not read as disconnected per-service events.

## Error handling

- A malformed or unparseable event is stored in a dead-letter form (raw payload + reason) rather than dropped silently — an audit system that silently loses records defeats its own purpose.
- `@hospital/audit-emitter` publishing failure must not block or roll back the originating write — audit is a side effect, not a transactional dependency of the business operation. A publish failure is retried via RabbitMQ's normal redelivery; it never becomes the reason a clinical or billing write fails.

## Testing

- Sensitive-field exclusion test: a write to any entity with an `@AuditExclude()`-marked field must never surface that field's value in the resulting `audit_record.diff`.
- Coverage test: a plain CRUD write through a service with no custom domain event still produces a `record.changed` audit record (proves the blanket-coverage decision actually holds, not just the named-event path).
- Cross-tenant isolation test, same category as every other service's.
