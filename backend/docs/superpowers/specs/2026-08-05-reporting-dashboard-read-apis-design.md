# Reporting Dashboard Read APIs — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 4 item 10 (`new-features.md` #13)
**Scope:** raw event query endpoint + 2 dashboard aggregation endpoints + RBAC. Export endpoints
(the fourth `new-features.md` #13 ask) are explicitly deferred (see Non-goals).

## Problem

`ReportingSubscriber` captures 6 business events (`OrderPlaced`, `InvoiceCreated`,
`PaymentRecorded`, `DepositReceived`, `PatientAdmitted`, `BedTransferred`) into a tenant-scoped
`reporting_events` table via `PersistingReportingEventPublisher`, but nothing reads it — no
controller, no service, no permission gates it. There's already a seeded `Auditor/Compliance` role
("Read-only access to audit trail and reporting", priority 30) with **zero permissions mapped** in
`seed-rbac-catalog.ts` — clearly meant for exactly this, and currently a dead role.

## Decisions

- **New permission: `reporting.read`.** Added to `PERMISSION_CATALOG` and mapped to
  `Auditor/Compliance`, `Hospital Admin`, and `Super Admin` in `ROLE_PERMISSION_MAPPINGS` —
  matching this codebase's existing per-domain `.read` pattern (every other domain's read
  permission goes to the same three role tiers). No other role gets it; reporting/audit visibility
  is not a front-line staff concern.
- **`ReportingQueryService` reads through the *main* connection pool**
  (`TenantConnectionService.runInTenantSchema()`, the same pattern every other domain service
  uses — e.g. `PatientsService`), **not** the dedicated `REPORTING_DATA_SOURCE` pool
  `PersistingReportingEventPublisher` writes through. That pool is deliberately capped at 3
  connections specifically so archiver writes never contend with business-transaction connections
  (see `reporting-data-source.ts`'s own docstring) — routing dashboard reads through it would let a
  slow aggregation query starve the archiver of one of only 3 connections, defeating the reason
  that pool exists. `ReportingEvent` is already registered in the main `DataSource`'s entity list
  (`data-source.ts:33/44`), so no new entity registration is needed for this to work.
- **Three endpoints, one new `ReportingController`, added to the existing `ReportingModule`:**
  - `GET /reporting/events` — filterable, paginated raw event list. Query params: `eventType?`
    (exact match), `from?`/`to?` (ISO date strings, filtering `occurredAt`), `page?`, `limit?`
    (default page 1, limit 50) — same `@Query()`-args-in-signature style `InvoicesController.list()`
    already uses, not a dedicated DTO class.
  - `GET /reporting/dashboard/event-counts` — daily count per `eventType` over a `from`/`to` date
    range, using the existing `(eventType, occurredAt)` index
    (`0017-create-reporting-tables.ts`) via `date_trunc('day', "occurredAt")` grouping.
  - `GET /reporting/dashboard/revenue` — daily summed amount over a `from`/`to` date range, reading
    `(payload->>'amount')::numeric` for rows where `eventType IN ('PaymentRecorded',
    'DepositReceived')`, grouped by day.
  - All three require `@RequirePermission('reporting.read')` behind `@UseGuards(PermissionGuard)`,
    matching every other controller in this codebase.
- **`ReportingModule` gains a `DatabaseModule` import** (for `TenantConnectionService` — it
  currently only imports `TenantContextModule`, since the write side never needed the main pool).
  `ReportingQueryService` and `ReportingController` are added to its `providers`/`controllers`.
- **No automated tests.** Per this session's standing fast-mode instruction, verification is
  manual: run the app, seed a few events by exercising real endpoints that trigger the 6 tracked
  actions (or insert test rows directly), then `curl` all three new endpoints with a valid
  `reporting.read`-holding token and confirm the shapes and filtering behave as expected.

## Non-goals

- **Export endpoints** (CSV/PDF for government or operational reports). `new-features.md` #13's
  fourth ask. This needs real product decisions this repo hasn't made anywhere yet — which report
  formats, for which audience/regulator, what layout — not a mechanical follow-on to the query
  endpoints above. Tracked as a separate future item once those decisions exist.
- **More than 2 aggregation endpoints.** Event-counts-by-day and revenue-by-day are the two agreed
  as most broadly useful for a first dashboard pass; anything more specific (e.g. a live
  currently-admitted-patient count correlating `PatientAdmitted` against discharge/transfer events)
  is a follow-on, not blocking this item.
- **A dedicated query-params DTO class with `class-validator` decorators.** Matches the simpler
  existing `@Query()`-args pattern (`InvoicesController.list()`) rather than introducing a new
  validation layer for this feature alone.
- **Changing anything about the write side** (`ReportingSubscriber`,
  `PersistingReportingEventPublisher`, `REPORTING_DATA_SOURCE`). This item is additive — a new read
  path alongside the existing write path, not a revision of it.

## Testing

- Manual verification only (see Decisions above) — no automated test added, per this session's
  fast-mode directive.
- Existing suite (`nx run-many -t typecheck test`) must stay green — this is additive: a new
  controller/service/permission plus one new `imports` entry on `ReportingModule`. No existing
  behavior changes.
