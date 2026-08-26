# Audit Service — Persist Real Audit Records — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §7, §8 Phase 0, §10)
**Supersedes (partially):** `2026-07-30-audit-service-design.md`, which assumed a separate microservice consuming RabbitMQ events. Under the 2026-07-31 modular-monolith pivot, the Audit Service is a domain module inside `apps/api`, and the "named domain events over RabbitMQ" half of that design is moot — no domain event bus exists or is planned (PRD §4). The blanket-coverage mechanism (`@hospital/audit-emitter`'s `AuditSubscriber`, hooking TypeORM's insert/update/delete lifecycle) is unaffected by the pivot and was already built and wired (into `AccountsModule`) in an earlier plan.

## Scope

Replace the current `LoggingAuditEventPublisher` stub (console-logs an `AuditEvent`, nothing persisted or queryable) with a real one that writes an `audit_records` row into the current tenant's schema. Extract the wiring (`AuditSubscriber`, the `AUDIT_EVENT_PUBLISHER` provider, the `OnModuleInit` push onto the shared `DataSource`) out of `AccountsModule` into its own `@Global()` `AuditModule`, so every current and future domain module's writes are covered without each one declaring its own audit providers.

**Explicitly deferred**, no consumer yet (same reasoning as the tenant registry's deferred `module_toggles`):
- A query/read API for the Auditor/Compliance role to browse the trail.
- Denormalized `changedByDisplayName` (the original design's stated reason — avoiding a stale display name if the account is later renamed — still holds, but resolving it requires a join at write time that adds real complexity for a field nothing reads yet).

## Data model

`audit_records` is tenant-scoped — lives inside each `tenant_<hospitalId>` schema, same as `accounts`/`account_roles` (Auditor/Compliance is a single-hospital role per PRD §6.1; Super Admin's existing cross-tenant schema-switching already covers vendor-side review). Its migration is added to `AccountsService.provisionTenantSchema`'s per-tenant migration list — the same place `accounts`/`account_roles` and the account-roles unique-assignment constraint are already provisioned — not to `data-source.ts`'s platform-level migrations array.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tableName` | varchar | e.g. `accounts` |
| `recordId` | varchar | the audited row's PK, as a string |
| `action` | varchar(20) | `create`\|`update`\|`delete` |
| `changedByAccountId` | varchar, nullable | from `TenantContextService.getAccountId()` at write time |
| `correlationId` | varchar, nullable | from `TenantContextService.getCorrelationId()` |
| `diff` | jsonb | array of `{field, before, after}`, sensitive fields already excluded by `@hospital/audit-emitter` before this ever sees it |
| `occurredAt` | timestamptz | |

No `hospitalId` column — implicit via the tenant schema the row lives in, matching `Account`'s existing convention.

## Error handling

Persisting a decision made explicit up front (compliance-relevant trade-off, confirmed): **a failed audit-record write is logged loudly and swallowed — it never blocks or fails the business write that triggered it.** This matches the original design's stated principle ("audit is a side effect, not a transactional dependency"), but the consequence is stronger now than it was under the original RabbitMQ design: there, a failed publish got redelivered later by the bus and nothing was truly lost. Without a bus, a failed audit write here is genuinely, permanently lost — an accepted trade-off at this scale, not a hidden regression.

## Testing

- A real write (e.g. `AccountsService.createStaffAccount`) produces a queryable `AuditRecord` row in the tenant's schema with the correct `diff`/`action`/`recordId`, and `passwordHash` never appears in it — the existing `accounts/audit-wiring.integration-spec.ts` already proves the diff-exclusion half (via a fake in-test publisher); a new test proves the persistence half specifically.
- Publish failure (simulated by calling the publisher with no tenant context active) resolves without throwing — proves the swallow-and-log behavior.
