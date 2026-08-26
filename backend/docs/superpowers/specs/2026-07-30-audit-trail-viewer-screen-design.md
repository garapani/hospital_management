# Audit Trail Viewer Screen — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§6.1); parent spec: `2026-07-30-audit-service-design.md`
**App:** `staff-console` (Angular v18+)

## Scope

A read-only view over Audit Service's `audit_records`. Last of the five Phase 0 frontend screens.

**Access control:** Hospital Admin (read-only, own tenant), Auditor/Compliance role (read-only, own tenant), Super Admin (read-only, any tenant via existing cross-tenant context switch). No account, at any privilege level, gets an edit or delete affordance on this screen — the audit trail is append-only by design (Audit Service spec), and the UI reflects that with no destructive controls existing at all, not just controls that are disabled.

## A required constraint, not an optional filter

Every mutating write across ~35 services and 10-20 tenants flows into this table via the shared `@hospital/audit-emitter` (per the Audit Service design) — this is a large, continuously growing dataset from day one, not something that grows into a performance concern later. The screen **requires a bounded date-range filter before running any query**, defaulted to the last 24 hours. There is no "browse all records" mode.

## Filters

Date range (required, defaulted to last 24h), service_name, table_name/entity, changed_by (account), action type (create\|update\|delete), correlation_id.

## List view

Paginated table: occurred_at, service_name, table_name, record_id, action, changed_by_display_name.

## Detail view

Selecting a record shows its full `diff` (before/after values). A **"View related events"** action queries by `correlation_id`, reconstructing the full cross-service trail for a single business operation (e.g. Order fulfilled → Billing charge created) — this is the concrete UI consumer of the `correlation_id` field designed into Audit Service specifically for this purpose.

## Sensitive-field handling

No client-side redaction logic is needed. `@hospital/audit-emitter`'s `@AuditExclude()` mechanism means excluded fields (password hashes, OTP codes, refresh-token hashes) are never captured into the `diff` in the first place — the UI simply renders whatever the backend returns, with nothing to hide on the frontend side.

## Scope boundary

Dead-lettered or malformed events (per Audit Service's error handling — stored rather than dropped, but flagged as unparseable) are **not surfaced in this viewer**. That's an operational data-quality concern for ops tooling, not a compliance record, and mixing it into the compliance-facing audit trail would confuse the two purposes.

## Testing

- E2E: the default view only ever issues a bounded (24h) query; no code path allows an unfiltered query to fire.
- E2E: each filter (service, table, changed_by, action, correlation_id) narrows results correctly.
- E2E: detail view renders the full diff for a selected record.
- E2E: "View related events" via correlation_id returns and displays the full multi-record trail.
- Static/UI test: no edit or delete control exists anywhere in this screen's component tree, for any role.
