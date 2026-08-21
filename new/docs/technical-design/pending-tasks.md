# Pending Tasks — Recommended Order

Source material: `new-features.md` (gap list) and `review-comments.md` (evidence, file:line
references). This document sequences those items by priority and dependency, not by the order
they were discovered.

**Ordering principle:** security gaps in a multi-tenant hospital EMR outrank everything else —
every day live with header-trusted auth/tenant resolution is real exposure. After that: cheap
guardrails that prevent the remaining backlog from making things worse, then ops-readiness, then
feature completion, then net-new platform work, then the multi-quarter product backlog last (it
follows the PRD's own phase order — no reason to re-litigate that). **Exception, as of
2026-08-09:** the "MVP hardening (fast track)" section below jumps this queue — see
`new/docs/technical-design/mvp-status.md` for how it was scoped and `CLAUDE.md`'s "The MVP Fast
Track" for the lighter process it's worked under.

## MVP hardening (fast track)

Identified by the `mvp-status.md` audit (2026-08-09): what's actually missing between the
already-built Phase 0/1 modules (Patient, Appointments, Admissions, Billing, Clinical basics —
built before this file's tracking regime existed, see `mvp-status.md`) and a genuinely usable
single-hospital registration → visit → bill → lab/pharmacy workflow. Deliberately excludes all
Phase 3+ backlog (Insurance/Claims, Accounting, Fixed Asset, etc., below) — those are out of MVP
scope, not merely lower priority.

- [x] **Billing: Return/credit-note concept.** Done: `InvoicesService.createReturn` +
      `POST /billing/invoices/:id/returns` let billing staff issue a return against a
      Paid/PartiallyPaid invoice (amount up to `paidAmount`), reducing `totalAmount`/`paidAmount`
      and recomputing `status` with the same rule `recordPayment` uses; rejects returns against
      invoices with no recorded payments (use `cancel` instead). See
      `new/docs/superpowers/specs/2026-08-09-billing-return-credit-note-design.md`. **Correction
      (2026-08-09):** the original Billing spec
      (`new/docs/superpowers/specs/2026-08-01-billing-design.md:9,145`) already deliberately
      deferred "Settlement" (credit-organization settlement — a corporate/insurance payer
      periodically reconciling a batch of credit-billed invoices) to Phase 3's Insurance & Claims
      module, since it depends on machinery that doesn't exist yet. `mvp-status.md`'s audit missed
      this — Settlement is correctly out of MVP scope, not a gap; dropped from this item.
- [x] **Billing: automatic charge-capture from Lab/Radiology/Pharmacy.**
      **Resolved (2026-08-20):** a real pricing data model + a working capture path now exist.
      Pricing: `lab_tests.price`, `radiology_imaging_items.price`, and `inventory_items.salePrice`
      (single currency ₹, nullable = not priced) added by migration `0031`; catalog create accepts
      the price and new `PATCH .../price` endpoints (lab.catalog.manage / radiology.catalog.manage /
      inventory.catalog.manage) set/update it. Capture: `ChargeCaptureSubscriber`
      (`billing/charge-capture.subscriber.ts`, wired like the audit/reporting/notification
      subscribers — tableName-filtered, no cross-module entity imports) fires when an `order_items`
      row transitions to `Completed` — the single choke point every clinical completion flows
      through (`OrdersService.completeItemInTransaction` → Lab verify / Radiology verify / Pharmacy
      dispense) — resolves the catalog price for the item's type, and appends a line (with
      `sourceOrderItemId`) to the patient's open invoice, creating one if none exists. Best-effort
      per the human partner's ruling: unpriced/unsupported items are skipped before any SQL write,
      so they never roll back the completing workflow. 8 new integration tests (charge capture +
      catalog pricing) — full suite 389 passed. See `Development-Standards.md` §27. **Both known
      follow-ups closed (2026-08-21):** `captureChargeForOrderItem` now takes a per-patient
      Postgres advisory lock (`pg_advisory_xact_lock(hashtext('charge_capture:<patientId>'))`)
      before the open-invoice find, so concurrent first captures cannot create two invoices, and a
      unique partial index (`invoice_items.sourceOrderItemId` where not null, migration `0049`)
      makes "one charge per order item" a database invariant; a recovery path exists at
      `POST /billing/invoices/charge-capture` (re-runs capture for a completed order item, safe to
      repeat — already-charged is a no-op).
- [x] **Appointments: doctor-schedule/availability endpoints.** Create/list/get/update/cancel
      exist; PRD's module description implies "doctor schedules" as in-scope. **Resolved
      (2026-08-20):** `GET /appointments/doctors/:doctorId/schedule` and
      `GET /appointments/departments/:departmentId/schedule` already exist (shipped with the
      appointment-scheduling work, commits `d64cebf`/`176ee45`), returning available/booked slots
      and department capacity, and `create` already enforces doctor-conflict and
      department-capacity checks. Verified live against the running API.
- [x] **Admissions: discharge-summary artifact.** Create/list/get/transfer/discharge exist as a
      status-machine action; PRD names discharge summaries explicitly (old system:
      `DischargeSummaryController`). **Resolved (2026-08-20):** the routes and a `DischargeSummary`
      entity existed, but the entity was never registered in `data-source.ts` and no migration
      created the table — every endpoint threw `EntityMetadataNotFoundError` (the initial
      "verified live" check only confirmed the routes mapped; corrected 2026-08-20). Now fully
      wired: entity registered + migration `0030` adds `discharge_summaries`; endpoints
      `POST /admissions/discharge-summaries`, `GET /admissions/discharge-summaries` (filterable by
      patient), `GET /admissions/discharge-summaries/by-admission/:admissionId`,
      `GET /admissions/discharge-summaries/:id`, `PATCH .../:id`, and `PATCH .../:id/review`
      (a review/sign-off flow); creation gated on the admission being discharged; covered by
      integration tests including the preparedBy/reviewedBy actor derivation.
- [x] **MVP end-to-end acceptance walk + demo data** (2026-08-21) — `src/app/mvp-workflow.integration-spec.ts`
      boots the real AppModule and walks the whole Basic-package flow over HTTP: patient →
      appointment → vitals/encounter → ward/bed → admission → order (Lab+Pharmacy+Radiology) →
      inventory stock (category→item→vendor→PO→goods receipt) → lab collect/results/verify →
      radiology scan/report/verify → pharmacy dispense → one auto-charged invoice with 3 lines →
      payment → employees → payroll run → notifications → reporting. Two real contract fixes fell
      out (sub-category create lives at `POST /inventory/sub-categories`, not under the category
      route; `recordPayment` returns the Payment, not the invoice) plus the charge-capture
      hardening above. **Demo seeder** `nx run api:seed-demo-data` (`database/seed-demo-data.ts`)
      fills the demo tenant with a ward/beds, 3 patients, appointments, a visit record, an
      admission, completed lab/radiology/pharmacy on one order (real charge-capture → an unpaid
      invoice for staff to demo payment on), 2 employees and a payroll run; idempotent (skips when
      the demo tenant already has patients).
- [x] **Staff account creation: no hardcoded passwords, no Super Admin minting, working
      must-change flow** (2026-08-21) — `POST /accounts` validates the role at creation (unknown /
      cross-tenant Super Admin / not-enabled-for-tenant all 400; the HTTP controller forces the
      internal seed-only `allowPlatformRole` escape hatch to `false`), generates a random 12-char
      initial password when none is supplied (returned once) and forces a change on first login.
      Login with a flagged account returns 403 `{mustChangePassword:true}` with no tokens; refresh
      rejects flagged accounts; the unauthenticated `POST /auth/change-password` (excluded from
      `AuthContextMiddleware` like login) verifies username + current password and only accepts
      still-flagged accounts. Frontend: create-user modal shows the generated password once and
      toasts errors; login routes to a new unguarded `/change-password` screen (username prefilled,
      interceptor treats the endpoint like `/auth/login` so a wrong current password can't trigger
      the session-clear redirect). Live-verified end to end; full suites green (backend 614,
      frontend 287). See `Development-Standards.md` §43. **Follow-up (2026-08-21):** the platform
      tenant is tenant-agnostic — platform operators get the cross-tenant roles (Super Admin);
      a platform admin can create/assign Super Admin operators (hospital tenants still 400);
      `assignRole` gained the same cross-tenant + enabled-for-tenant guards as
      `createStaffAccount`. **Correction (2026-08-21):** the platform picker is platform-only,
      not the whole catalog — `GET /accounts/roles` in the platform tenant returns just Super
      Admin (never Doctor/Nurse, which would leak hospital permissions into platform JWTs since
      `filterPermissions` is platform-exempt), and hospital-role creation/assignment in the
      platform tenant → 400. Live-verified (platform picker [Super Admin], Doctor 400, Super
      Admin 201; demo picker 13 roles, Super Admin 400). Backend suite 624 passed.

## Phase 0 — Housekeeping

- [x] Commit `new-features.md`, `review-comments.md`, the `PRD.md` move, and the new ADR
      (`276d5ac`)
- [x] Fix moved-path references (new-features.md #16) — bundled into the same commit
      (`276d5ac`)
- [x] **Manual cleanup left over from the reporting-archiver session** (2026-08-21) — stale
      `worktree-feat-reporting-archiver` branch deleted (work had landed on main via the
      reporting-archiver session's own commits); `scratch_rep_check` schema confirmed already
      absent from dev Postgres. Note: orphaned schemas `tenant_lab_report_pdf_1` /
      `tenant_radiology_report_pdf_1` (no registry rows) remain from an earlier PDF session —
      candidates for the next cleanup.

## Phase 1 — Close the security gaps

1. [x] **Shared `inTenant()` test helper** (new-features.md #5) — done: `apps/api/src/testing/tenant-test-context.ts`, all ~40 integration specs migrated. Build *before* item 3. Proving
   tenant isolation requires reliable, consistent test infrastructure; building the helper after
   item 3 lands would mean rewriting its isolation tests.
2. [x] **JWT-backed request auth** (new-features.md #1) — done: `AuthContextMiddleware`
   (`libs/auth-guards`), `POST /auth/refresh`, all controller-style integration specs migrated
   onto real tokens via `signTestToken()`.
3. [x] **Database-enforced tenant isolation** (new-features.md #2) — done: per-tenant `NOLOGIN`
   Postgres roles + schema grants, `SET LOCAL ROLE` inside a real transaction in
   `TenantConnectionService`, a real production tenant-provisioning path (didn't exist before this
   item), and the `migrate-tenants` backfill runner that closed the dependency below. Note: the
   dedicated cross-role DB-level isolation test (proving Postgres itself rejects a cross-tenant
   query) was deferred — the human partner is prioritizing a prototype demo and will add test
   coverage for this item afterward. **Done 2026-08-20:** the DB-level proof now lives in the
   `SET LOCAL ROLE` describe of `tenant-connection.service.integration-spec.ts` — a
   schema-qualified read AND a write against another tenant's schema both fail with
   `permission denied for schema` under the tenant's own role, with a same-schema positive control.
- [x] **Role catalog is Super Admin only** (2026-08-21) — `GET/POST /roles` (the shared global
      catalog behind the platform console's Global Catalog screen) previously required
      `master-data.manage`, which is always-on for customers, so any hospital admin could create
      roles via the API even though the screen is platform-only. New `rbac.manage` permission
      mapped to **Super Admin only** (and not in the always-on list) now gates both endpoints;
      hospital admins map (assign) roles to users through the tenant-scoped `/accounts/roles`
      picker instead. Seeded live via `nx run api:seed-rbac` (idempotent); verified live
      (superadmin 200/201, demoadmin 403 `Missing required permission: rbac.manage`). Backend
      suite 626 passed. See `Development-Standards.md` §44.
- [x] **Platform-console gaps: password reset, role revocation, tenant history** (2026-08-21) —
      from the platform-screen review: `POST /accounts/:id/reset-password` (forgotten-password
      recovery — generated one-time password or admin-supplied temp, always forces a change and
      clears lockout); role chips on user detail can now revoke a specific assignment, guarded so
      the **last Super Admin in the platform tenant can never be removed** (platform lockout
      prevention); tenant detail gained a "Platform history" panel (audit events per tenant via a
      new `recordId` audit filter). Building it exposed + fixed an audit bug: the subscriber
      derived recordIds from a hardcoded `entity['id']`, so every `tenants` audit row had an
      empty recordId (Tenant's PK is `hospitalId`) — now resolved from TypeORM PK metadata.
      Live-verified (reset → 403 must-change → login; revoke-to-last → 400; tenant history
      returns the provision event with its hospitalId). Backend suite 636, frontend 304. See
      `Development-Standards.md` §45.
- [x] **Global catalog edit + deactivate; department catalog platform-only** (2026-08-21) — the
      catalog was create-only: `PATCH /roles/:id` (description/priority, name immutable),
      `PATCH /roles/:id/deactivate|reactivate` (soft-remove: pickers + new assignments stop
      offering it, existing assignments keep working; Super Admin can never be deactivated), and
      the same edit/deactivate for `/catalogs/departments`. Also closed the second
      `master-data.manage` hole: department catalog endpoints moved to `rbac.manage`
      (Super Admin only) — a hospital admin with `master-data.manage` gets 403 on every catalog
      endpoint now. Live-verified (role create/edit/deactivate hidden from the demo picker /
      reactivate, Super Admin deactivate 400, dept catalog edit/deactivate, demoadmin 403).
      Backend suite 646, frontend 317. See `Development-Standards.md` §46.

## Phase 2 — Guardrails while the backlog grows

4. [x] **Nx module-boundary lint** (new-features.md #3) — done: `@nx/enforce-module-boundaries`
   tags the 4 real Nx projects, `eslint-plugin-boundaries` tags the domain folders inside
   `apps/api`, both wired into CI via the `lint` target.
5. [x] **Deployment path + runbook fixes** (new-features.md #4 + #17) — done: `Deployment-Guide.md`
   and `Runbook.md` now match the real env var names, build output path, start command, and
   migration behavior (not automatic; platform vs. tenant migrations; `migrate-tenants` target);
   **Update (2026-08-20):** the two formerly-outstanding claims are both closed — the standalone
   migration runners work outside Jest (see the "Dependencies" section; `Development-Standards.md`
   §26) and the repo now ships a production `Dockerfile` + `docker-compose.prod.yml` (Postgres +
   Redis + MinIO + API with a published port, plus a one-shot `migrate` service); `Deployment-Guide.md`
   documents the containerized path. Also fixed the Runbook's `afterTransactionCommit`/rollback-sandbox claims, which
   don't exist anywhere in the codebase.

## Phase 3 — Production-readiness ops

6. [x] **Observability stack** (new-features.md #10) — **structured logging only**, done: JSON
   logs via `nestjs-pino`, tagged with `tenantId`/`accountId`/`correlationId` automatically via a
   pino `mixin` reading `TenantContextService`, redaction backstop for known-sensitive keys. The
   **Prometheus metrics shipped 2026-08-20** (`@hospital/observability` MetricsService +
   `GET /metrics`, unauthenticated-by-design for scrapers, aggregate counters only): default
   process metrics + an HTTP histogram/counter labeled method/route/status/tenant, wired via an
   in-process middleware; `deploy/prometheus.yml` + a `prometheus` service in
   `docker-compose.prod.yml`; 4 tests. **Still not done:** OpenTelemetry tracing, Grafana/Loki
   dashboards and alert rules — these are what item 9 (load testing) and staging auth/isolation
   work should wait on.
7. [x] **Connection pooling/tenant limits** (new-features.md #9) — **global pool max + statement
   timeout only**, done: `DB_POOL_MAX` (default 20), `DB_STATEMENT_TIMEOUT_MS` (default 30000ms) on
   the main `DataSource`. Per-tenant caps (needs PgBouncer) and tenant-tagged metrics/alerts (needs the
   observability stack deferred out of item 6) are **not done**.
8. [x] **Backup/restore runbooks** (new-features.md #6) **+ hardware failure recovery plan**
   (new-features.md #7) — done: `scripts/backup-db.sh` (nightly `pg_dump -Fc`, S3-compatible
   India-region offsite target, 30-day retention), full + per-tenant restore procedures and a
   monthly restore-drill procedure in `Runbook.md`, and a Hostinger-VPS-path hardware-failure
   recovery runbook (~4h target RTO). Scoped to the VPS hosting path only — `PRD.md` §12 open
   question #1 (self-owned server vs. VPS) is still unresolved. **Not done:** continuous WAL/PITR
   (24h RPO accepted instead), a self-owned-server recovery runbook, and naming a real
   owner/escalation contact (left as an explicit placeholder).
9. **Reference server sizing + load test** (new-features.md #8) — only meaningful once
   observability (item 6) and pooling (item 7) are in place to measure against.

## Phase 4 — Complete near-finished features

10. [x] **Reporting dashboard read APIs** (new-features.md #13) — done: `GET /reporting/events`
    (filterable/paginated list), `GET /reporting/dashboard/event-counts` and
    `GET /reporting/dashboard/revenue` (daily aggregations), all gated by a new `reporting.read`
    permission wired to `Super Admin`/`Hospital Admin`/`Auditor/Compliance` (the latter's first-ever
    permission grant). **CSV export shipped 2026-08-20** (RFC 4180 serializer +
    `GET /reporting/events/export.csv` whole-set capped at 10000 rows + `GET /reporting/dashboard/revenue/export.csv`,
    both reporting.read-gated with attachment headers; 5 tests). **Not done:** PDF export (deferred —
    CSV is the government/operational-reporting format of choice for Excel/Tally workflows).

## Phase 5 — New platform capabilities

11. [x] **Redis integration** (new-features.md #11) — **Redis container + rate limiting only**,
    done: `docker-compose.dev.yml`'s `api-redis` service, `@nestjs/throttler` with a Redis-backed
    storage adapter, global 100/60s default plus a stricter 5/60s override on
    `POST /auth/login`/`POST /auth/refresh`. **Not done:** permission cache (deferred — the
    existing JWT-embedded-permissions mechanism already bounds staleness to 15 minutes without
    Redis; `PRD.md` §6.2 corrected to describe this instead) and master-data read-through cache
    (deferred, no driving need yet).
12. [x] **MinIO/object storage integration** (new-features.md #12) — done: `@hospital/object-storage`
    library (MinIO client + tenant-namespaced key policy, single shared bucket per PRD.md §9.1),
    local dev MinIO container. **Not done:** upload/download REST endpoints (deferred — domain
    modules consume `ObjectStorageService` directly instead) and an actual backup script (deferred —
    `Runbook.md` §7 documents the policy for when one exists). **First real consumer shipped
    2026-08-21:** Lab and Radiology verified-report PDF export mirrors each rendered PDF to
    `reports/lab/<requisitionNumber>.pdf` / `reports/radiology/<requisitionNumber>.pdf`
    (best-effort — the completing workflow never rolls back if the mirror fails).
13. **India compliance roadmap** (new-features.md #14) — product-scoping work, not blocking
    engineering.
14. [x] **Platform (Super Admin) console above tenants.** Super Admin accounts moved out of the
    `demo` hospital into a reserved `__platform` system tenant; `staff-console` split into a platform
    console (`/platform/*`, `PlatformShell`) and the tenant console (`AppShell`), guarded by
    `platformGuard`/`tenantGuard` and reached at `admin.*` vs. the bare host. Platform users have no
    access to tenant data — enforced structurally by JWT-derived schema resolution, not by new
    per-endpoint guards. Spec: `new/docs/superpowers/specs/2026-08-13-platform-superadmin-console-design.md`.
    Plan: `new/docs/superpowers/plans/2026-08-13-platform-superadmin-console.md`.
15. [x] **SaaS packages / edition tiering** (product decision 2026-08-21) — a package is a curated
    set of module permission groups; tenant creation picks one so only those features are
    available. Basic (14 modules — the **MVP launch tier**, incl. radiology, employee, payroll) →
    Standard (+25: ward-supply, nursing, OT, maternity, CSSD, vaccination, fixed-assets, helpdesk,
    marketing, SSU, fraction) → Enterprise (+28: insurance, accounting, Document & Print).
    Implemented as **resolution-time gating**: `packages` catalog table (public schema, seeded by
    migration `0048`, with `tenants.packageCode` FK, default 'basic'; pre-existing tenants
    grandfathered to 'enterprise'), `PackagesService.filterPermissions()` applied at
    login/refresh so a tenant's JWTs only carry in-package permissions — 403 via the existing
    PermissionGuard and permission-driven console menus, no per-request machinery, no data
    partitioning. `POST /tenants` accepts `packageCode` (validated; 400 on unknown), `GET /packages`
    lists the catalog, `PATCH /tenants/:hospitalId/package` upgrades/downgrades (takes effect at
    next login/refresh — in-flight JWTs keep their list until expiry, same staleness as role
    changes). Platform tenant (`__platform`) is never filtered; unknown codes fail open. 12 new
    integration tests incl. end-to-end login JWT assertions. See `Development-Standards.md` §38.
    **Not done:** the platform console's package picker in the tenant-creation form (frontend repo)
    and a self-serve upgrade path (backend is ready; product chose platform-admin-only changes).
    **Package-driven provisioning closed (2026-08-21):** packages now name `defaultRoleNames`
    (Basic = 11 operational roles, Standard + Helpdesk Agent, Enterprise + Patient; Super Admin
    never auto-enabled); provisioning auto-enables them (no role picker) and package changes
    add-only reconcile the new package's roles. The provision form only asks hospital name/id +
    package, and surfaces backend errors instead of failing silently (the reported "didn't create,
    no error" was the modal swallowing the failure). Two real bugs found and fixed on the way: the
    `Tenant.roles` ManyToMany cascade silently no-oped (tenant_roles stayed empty; now inserted
    explicitly), and the audit subscriber wrote global-entity audit rows through the caller's
    transaction with `search_path=public` — which poisoned tenant creation once the legacy
    `public.audit_records` was cleaned up (now always written on a dedicated connection into the
    operator's schema). See `Development-Standards.md` §40.

## Phase 6 — Product module backlog

Follow the PRD's own phase ordering as-is:

- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. ~~report/PDF export~~ **closed 2026-08-21:** verified
        reports export as PDF via the `@hospital/pdf` platform lib (pdfmake 0.2.20 UMD + bundled
        Roboto vfs) at `GET /lab/requisitions/:id/report.pdf` (Verified-only, `application/pdf`,
        mirrored to object storage under `reports/lab/<requisitionNumber>.pdf`); unit + endpoint
        integration tests assert `%PDF-` magic bytes and the 409 pre-verification guard. **Not
        done:** machine/instrument (LIS) integration, external lab send-out, government
        disease-reporting mapping, multi-level verification, result amendment history/audit trail
        (corrections currently overwrite in place with no version row — acceptable for now since
        only pre-verification edits are allowed, but named explicitly rather than left silent) —
        each a distinct future item. ~~`OrderItem.status` never advancing when its lab requisition
        is verified~~ **closed 2026-08-20:** verification now routes through
        `OrdersService.completeItemInTransaction`, so the `OrderItem` advances to `Completed` at
        the same time (the ordering doctor gets the signal from the Order module).
  - [x] Radiology core pipeline (imaging catalog, requisition/scan tracking, single-field report
        entry, single-level verification) — done. ~~PDF export~~ **closed 2026-08-21:** verified
        reports export as PDF via the shared `@hospital/pdf` lib at
        `GET /radiology/requisitions/:id/report.pdf` (Verified-only, `application/pdf`, mirrored
        to object storage under `reports/radiology/<requisitionNumber>.pdf`). **Not done:** image
        attachment (`@hospital/object-storage` integration), film type/quantity billing tracking,
        DICOM integration (confirmed a wholly separate old-system domain — its own models, own
        controller), report template HTML rendering, result amendment history/audit trail — each
        a distinct future item. ~~`OrderItem.status` never advancing on verification~~
        **closed 2026-08-20:**
        Radiology verification also routes through `OrdersService.completeItemInTransaction` (same
        fix as Lab's). Request-body validation for the required workflow
        fields (`reportText`, `reportEnteredBy`, `scannedBy`, `verifiedBy`) is now enforced by
        explicit service-layer guard clauses plus database CHECK constraints (added in a final-review
        fix), closing a gap where an empty/malformed request body could previously have produced a
        `Verified` report with NULL text/author.
  - [x] Inventory Item A — procurement pipeline (item category/sub-category/item/vendor catalog,
        purchase order create/read/cancel, goods receipt, stock balance query) — done. **Not
        done:** RFQ/Quotation, two-phase unconfirmed stock staging, store/location dimension,
        vendor accounting fields (TDS/ledger/credit period), donations/returns/write-offs,
        multi-store/currency/fiscal-year masters, formal PO approval workflow — each a
        distinct future item.
  - [x] Inventory Item B — requisition/dispatch pipeline (department-based stock requisition
        create/read/cancel, FEFO-ordered locked fulfillment against `stock_balances`, requisition
        status machine `Pending` → `PartiallyFulfilled`/`Fulfilled`, with `Cancelled` from
        `Pending`) — done; see `Development-Standards.md` §17. **Not done:** store-to-store/
        sub-store routing (no store/location dimension exists yet — same scope cut as Item A),
        multi-level verification/approval chains (fulfillment is single-step, no approval gate
        before a requisition line is dispatched), fixed-asset dispatch tracking (this pipeline
        covers consumable stock only), "direct dispatch" (there is no way to decrement stock
        without first creating a requisition record), manual batch selection (FEFO — nearest
        expiry first — is the only supported fulfillment strategy, with no override to pick a
        specific batch), and a clean close-out path for a stuck requisition (a requisition with
        any line fulfilled can never be cancelled — matches Item A's PO
        cancel-only-from-`Ordered` rule exactly, so this isn't an Item B-specific defect — meaning
        a requisition with one line that can never be fully filled, e.g. an item gets
        discontinued mid-fulfillment, has no path out and sits at `PartiallyFulfilled`
        indefinitely; needs a future "close/write-off a stuck requisition" item) — each a distinct
        future item if ever needed. **With both Item A and
        Item B complete, Inventory as a whole is positioned to unblock Pharmacy** (the next Phase 6
        item, which depends on a working stock pipeline).
  - [x] Pharmacy — prescription dispensing pipeline (order-routed dispensing create/read/cancel
        against `OrderItem`s with `itemType='Pharmacy'`, race-safe duplicate-dispensing prevention,
        FEFO-ordered locked stock decrement against the same `stock_balances`/`stock_batches`
        tables Inventory Item B uses, two-step status machine `Pending` → `Dispensed`, with
        `Cancelled` from `Pending`) — done; see `Development-Standards.md` §18. **Not done:**
        walk-in/OTC sales (every dispensing requires an existing `OrderItem`; there is no
        code path for a patient without a doctor's order), a separate dispensing-verification step
        (unlike Lab/Radiology's three-step create→enter→verify shape, dispensing is only
        create→dispense, no second-actor sign-off), a pharmacy-specific drug catalog (generic name,
        dosage form, strength, controlled-substance flag — a drug is just an `InventoryItem`, same
        catalog Inventory Item A built), POS/checkout (owned by Billing, not duplicated here;
        `dispenseDrug` never touches a billing/charge table), rack/bin physical location tracking,
        credit billing/credit notes/supplier ledger, narcotic/controlled-substance regulatory
        logging, sales returns, write-offs (a `Dispensed` record is terminal, no reversal path),
        and provisional IPD consumption billing — each a distinct future item if ever needed.
  - DICOM — not started (confirmed a wholly separate PACS-facing domain in the 2026-08-14
    review; needs its own scoping). **Ward Supply is done (2026-08-20):** ward sub-store stock
    ledger — receive/consume transactions, per-department+item balances (atomic upsert),
    consumption optionally tied to patient/admission, actor-derived performedBy. Permissions
    `ward-supply.read`/`ward-supply.manage` → Nurse, Hospital Admin, Super Admin. Migration
    `0036`; 9 tests. Future items: auto-posting fulfilled Inventory requisitions into ward
    balances (needs the store/location dimension), ward-to-ward transfers.
- **Frontend feature pages (2026-08-20, separate repo `frontend/`):** the tenant console's missing
  pages are now built and routed — Lab/LIS (requisitions workflow + test catalog), Radiology
  (requisitions workflow + imaging catalog), Pharmacy (dispensing + dispense), Inventory (items,
  purchase orders, stock requisitions with fulfillment), Admissions/ADT (transfer/discharge +
  discharge summaries), Orders (place + detail), and Reporting (dashboard + events). 249 frontend
  tests pass; production build succeeds (commit `b89ad01` in the frontend repo). Not yet built:
  a notifications page, vitals/encounters pages, and patient-portal.
- Phase 3: Verification — not started (its payer/eligibility checks substantially overlap the
  insurance module's `checkCoverage`). **Fixed Asset**, **Insurance & Claims**, and **Accounting**
  are done for their MVP scopes.
  done for their MVP scopes.
  - **Insurance & Claims (2026-08-20):** `insurance` module — payer master (Government/Private),
    patient insurance policies (coverage window, sum insured, copay, eligibility check
    `GET /insurance/policies/:id/coverage`), and a claims lifecycle linked to invoices
    (Draft -> Submitted -> Approved -> Paid / Rejected, auto `CLM-…` numbers, actor-derived
    submitter/processor per §25, row-locked transitions). Permissions `insurance.read`/
    `insurance.manage` wired to Billing/Accounts Staff, Hospital Admin, Super Admin. Migration
    `0034`; 8 integration tests. Not done (future items): external referrals
    (`ExtReferralModels`), PM-JAY/Medicare-specific claim formats (deferred to the compliance
    adapter per PRD §5.7), payer-side settlement reconciliation, and a frontend page.
  - **Accounting (2026-08-20):** `accounting` module — hierarchical chart of accounts
    (Asset/Liability/Equity/Income/Expense + soft-delete), double-entry journal entries (balanced
    lines, `Draft -> Posted` immutable, auto `JRN-…` numbers, actor-derived createdBy/postedBy per
    §25), and read-only financial reports: trial balance (per-account debit/credit totals), income
    statement (revenue − expenses = net income), and balance sheet (assets = liabilities + equity
    + retained earnings). Permissions `accounting.read`/`accounting.manage` wired to Billing/
    Accounts Staff, Hospital Admin, Super Admin. Migration `0035`; 7 integration tests (reports
    tested hermetically in a dedicated tenant). Not done (future items): automatic journal posting
    from Billing/charge-capture (ledger mapping — the old system's `DanpheEMR.AccTransfer`),
    reversing/correcting posted journals, fiscal-year closing, account reconciliation, and a
    frontend page.
  done for its MVP register scope (2026-08-20):** `fixed-assets` module with asset categories +
  asset register (auto asset codes, purchase date/cost, supplier, department assignment,
  condition In Service/Under Repair/Retired), paginated list, update, soft-delete
  (deactivate/reactivate, §28 convention), and read-time straight-line depreciation
  (`GET /fixed-assets/:id/valuation` — accumulated + book value; stateless, no accrual job).
  Permissions `fixed-asset.read`/`fixed-asset.manage` wired to Super Admin / Hospital Admin /
  Inventory & Store Manager. Migration `0033`. Not done (future items): depreciation
  schedules/periodic accrual, disposal/write-off, asset transfers between departments,
  maintenance/AMC tracking, and a frontend page.
- Phase 4: Clinical/EMR long tail — remaining slice is medical-records extras; **Vaccination is
  done (2026-08-20)** (patient vaccination records: vaccine, dose number, date, batch,
  actor-derived administeredBy; permissions `vaccination.read`/`vaccination.manage` → Doctor,
  Nurse, Hospital Admin, Super Admin; migration `0047`; 5 tests). **Nursing**, **OT**,
  **Maternity**, and **CSSD** are done for their MVP scopes; **Emergency is covered by the
  existing triage module** (ER intake/triage per PRD).
  (2026-08-20); Emergency is covered by the existing triage module** (ER intake/triage per PRD).
  - **Nursing:** nursing tasks (Pending -> InProgress -> Completed / Cancelled, row-locked,
    actor-derived createdBy/completedBy) + MAR medication-administration records
    (Scheduled -> Administered / Skipped, actor-derived administeredBy). Permissions
    `nursing.read`/`nursing.manage` → Nurse, Doctor (read), Hospital Admin, Super Admin. Migration
    `0037`; 12 tests.
  - **OT:** surgery scheduling (auto `SUR-…` numbers, patient + admission-ownership validation,
    Scheduled -> InProgress -> Completed / Cancelled, actor-derived scheduledBy). Permissions
    `ot.read`/`ot.manage` → Doctor, Nurse, Hospital Admin, Super Admin. Migration `0038`; 7 tests.
  - **Maternity (2026-08-20):** labor/delivery records per admission — antenatal info
    (gravida/para/LMP/EDD) + delivery outcome (date, type Normal/C-Section/Instrumental, baby
    count, complications) with a record-once guard (a recorded delivery cannot be re-edited) and
    actor-derived deliveredBy. Permissions `maternity.read`/`maternity.manage` → Doctor, Nurse,
    Hospital Admin, Super Admin. Migration `0039`; 10 tests.
  - **CSSD (2026-08-20):** sterile supply tracking — instrument catalog (soft-delete) +
    sterilization cycles (Steam/ETO/Chemical; InProgress -> Completed/Failed, sterile-expiry =
    completion + sterileHours, actor-derived operatedBy); deactivated instruments reject new
    cycles. Permissions `cssd.read`/`cssd.manage` → Nurse, Hospital Admin, Super Admin. Migration
    `0040`; 11 tests.
- Phase 5: done (2026-08-20) — **Employee**, **Payroll**, and **Fraction & Incentive** all shipped.
  - **Payroll:** monthly payslips computed from the employee master's `monthlyBasicSalary`
    (allowance%/deduction% config, gross/net, 2dp rounding), unique per employee+period
    (idempotent re-runs skip existing), Draft -> Paid (row-locked), actor-derived processedBy.
    Permissions `payroll.read`/`payroll.manage` → HR/Payroll Admin, Hospital Admin, Super Admin.
    Migration `0042`; 10 tests.
  - **Fraction & Incentive:** doctor revenue-share rules (percent 0-100, optional department,
    soft-delete) + fraction entries computed against real invoices (explicit rule or the doctor's
    default rule, snapshot of percent+base, actor-derived recordedBy). Permissions
    `fraction.read`/`fraction.manage` → Billing/Accounts Staff, Hospital Admin, Super Admin.
    Migration `0043`; 9 tests.
  - (Employee shipped earlier this session — see the Phase 5 note above this one.)
  **Employee was done (2026-08-20):** HR
  employee master — auto `EMP-…` numbers, department reference, employment type, monthly basic
  salary (the payroll base), searchable/paginated list, soft-delete. Permissions
  `employee.read`/`employee.manage` → HR/Payroll Admin, Hospital Admin, Super Admin. Migration
  `0041`; 8 tests.
- Phase 6: Document and Print, full Reporting/Dashboard — not started. **Helpdesk**, **Marketing
  & Referral**, and **Social Service Unit are done (2026-08-20)**.
  - **Marketing & Referral:** referral-source catalog (typed, soft-delete) + patient referral
    records (source must be active, optional referring doctor, actor-derived recordedBy).
    Permissions `marketing.read`/`marketing.manage` → Hospital Admin, Super Admin. Migration
    `0045`; 7 tests.
  - **Social Service Unit:** charity/subsidized-care cases (auto `SSU-…` numbers, subsidy percent
    0-100, Open -> Approved/Rejected -> Closed row-locked, actor-derived appliedBy/approvedBy).
    Permissions `ssu.read`/`ssu.manage` → Hospital Admin, Super Admin. Migration `0046`; 5 tests.
  - (Helpdesk shipped earlier this session — see the Phase 6 note above this one.) **Helpdesk is done (2026-08-20):** internal ticketing — auto
  `HLP-…` numbers, priority, Open -> InProgress -> Resolved -> Closed (row-locked, actor-derived
  requester/resolver), assignable, q-search. Permissions `helpdesk.read`/`helpdesk.manage` →
  Helpdesk Agent, Hospital Admin, Super Admin. Migration `0044`; 5 tests. **Notification** is now started/done as a slice ahead of its
  phase slot: the module (CRUD + summary + mark-read/mark-all-read endpoints, in-app
  `notifications` table migration `0028`, and in-process subscribers wired for admission and
  appointment creation) shipped in `a203100` + `93df331`; no email/SMS/push channel exists yet,
  and the frontend has a notifications feature folder but no routed page yet.

## Dependencies worth calling out explicitly

- **Phase 3, item 9** (load test) should follow items 6–7, not precede them.
- [x] **Resolved (2026-08-20):** `migrate.ts`/`migrate-tenants.ts` (and the `seed-rbac`/
      `seed-initial-setup` runners) can't be invoked outside Jest — the nx targets hung with no
      output. Root cause: the swc-node ESM loader (`--import @swc-node/register/esm-register`)
      keeps two worker IPC pipes open, and `data-source.ts` registers a never-cleared
      pool-monitor `setInterval` when `NODE_ENV !== 'test'` — so the work completed fine but the
      process never exited. Fixed with explicit `process.exit(0)` on success in all four runner
      scripts (they already exited 1 on error). Verified: `nx run api:migrate` and
      `api:migrate-tenants` exit 0, and `migrate-tenants` now backfills the new
      `discharge_summaries` migration (0030) onto existing dev tenant schemas. **Also fixed the
      migration-tracking drift it surfaced:** the 0008 patients migration was renamed in the
      `3741e67`/2026-08-14 fix, so any schema provisioned before that records the old name and
      TypeORM tries to re-apply it (`relation "patients" already exists`); the three pre-fix dev
      schemas' `migrations` rows were renamed to match the current
      `CreatePatientTables0008_2000000000005`. See `Development-Standards.md` §26.
- [x] **Resolved (2026-08-20):** the codebase-wide "actor fields are client-supplied" gap — every
  domain module's actor fields (`enteredBy`, `verifiedBy`, `sampleCollectedBy`, `scannedBy`,
  `reportEnteredBy`, `createdBy`, `receivedBy`, `returnedBy`, `refundedBy`, `dispensedBy`,
  `fulfilledBy`, `recordedBy`, `requestedBy`, `orderedBy`, `completedBy`, `transferredBy`,
  `dischargedBy`, `preparedBy`, `reviewedBy`, `triagedBy`, tenant `createdBy`) are now derived
  from the authenticated principal: each service resolves the actor via
  `TenantContextService.getAccountId()` (set by `TenantContextMiddleware` from the verified JWT)
  with the caller-supplied value only as a fallback for non-HTTP callers, and the DTO fields are
  optional-but-ignored. **Deliberate exception:** triage's `broughtBy` (who accompanied the
  patient — a companion, not the logged-in user) stays client-suppliable. 26 new integration
  tests pin the override across all 10 modules. See `Development-Standards.md` §25. Along the way
  this pass **found and fixed a real defect**: the `DischargeSummary` entity was never registered
  in `data-source.ts` and no migration created `discharge_summaries`, so every discharge-summary
  endpoint threw `EntityMetadataNotFoundError` — the earlier "verified live" check-off was wrong
  (it only confirmed the routes mapped). Fixed with entity registration + migration `0030`
  (`CreateDischargeSummaryTable0030`); `admissions.service.integration-spec.ts` now covers
  preparedBy/reviewedBy too.
- [x] **Resolved (2026-08-20):** `InvoicesService.recordPayment`/`.cancel` missing locks — both
  methods already take `pessimistic_write` on their initial invoice lookup in HEAD (added in
  `c416f0a`, 2026-08-14, the same commit that introduced the billing adapters); the review that
  flagged this predates that commit, so the item was stale. Verified in code (`cancel`,
  `recordPayment`, and `createReturn` all lock).
- [x] **Resolved (2026-08-20):** the flaky
  `persisting-reporting-event-publisher.integration-spec.ts` "SQL-level failure" test. Root cause:
  `runInTenantSchema` sets `search_path` to `("tenant_X", public)`; when the test renames the
  tenant's `reporting_events` table away, the unqualified INSERT falls through to a stale
  `public.reporting_events` leftover from the pre-tenant-schema era, so the failure surfaces as
  42501 `permission denied for table reporting_events` (the tenant role has no grants on public
  tables) instead of the expected 42P01 `relation ... does not exist` — and the old assertion only
  accepted 42P01. The assertion now accepts both SQL-level failure modes; the
  business-transaction-commits invariant is unchanged. Related gotcha also found: the global RBAC
  catalog tables (`roles`/`permissions`/`role_permissions`) live in `public`, not per tenant, so
  removing a mapping from `seed-rbac-catalog.ts` never propagates to an existing dev DB — four
  leftover `Super Admin → patients.*` rows from an older seed made
  `seed-rbac-catalog.integration-spec.ts` fail until deleted by hand.
- [x] **Resolved**: `database/migrations/0008-create-patient-tables.ts`'s migration `name` had a
  malformed timestamp suffix (`CreatePatientTables0008200000000008`, parsing to `8200000000008`),
  sorting it dead-last among all 28 migrations instead of 8th and breaking every migration with an
  FK on `patients` on any freshly-provisioned schema. Found and fixed during the 2026-08-14
  architecture-review pass; see `Development-Standards.md` §23 for the full analysis.
- [x] **Resolved (2026-08-17, commit `56c5ae6`):** `encounters.controller.integration-spec.ts`
  hanging in isolation — root cause was `ThrottlerStorageRedisService` defaulting to port 6379
  while the dev compose maps Redis to 6380; every authenticated HTTP request hung retrying
  (ioredis `maxRetriesPerRequest`) and blew past Jest's timeout. Documented in `app.module.ts`'s
  throttler comment block.
- [x] **Resolved (2026-08-20):** the `DepositsService.list`/`InvoicesService.list` positional-arg
  signature mismatch — the tests were stale (pre-pagination). All four call sites now use the
  query-object signature and assert the `{ data, meta }` shape (`meta.total`/`meta.page`/
  `meta.limit`); `appointments.service.integration-spec.ts` had the same two stale patterns and
  was fixed alongside.
- **New infra note (2026-08-20):** full-AppModule integration suites need more than Jest's
  default 5000ms per hook/test when many suites run in parallel workers;
  `apps/api/jest.config.cts` now sets `testTimeout: 60000`. Separately, the ThrottlerGuard
  previously shared ONE Redis-backed counter across every parallel test app instance, so a
  full-suite run could aggregate past the guest/authenticated limits and 429 unrelated suites; in
  test mode (`NODE_ENV=test`) the throttler now uses its default per-app in-memory storage (the
  real guard path still runs; see `app.module.ts`). Both verified with the full suite green
  (2026-08-20).
- [x] **Resolved**: `eslint.config.mjs`'s `boundaries/elements` never tagged `lab`/`radiology`/
  `pharmacy`/`inventory` — the module-boundary lint had zero coverage of the four newest, most
  cross-coupled domains, and (exploiting that blind spot) Lab/Radiology/Pharmacy were bypassing
  `OrdersService` to mutate `OrderItem` directly and calling `InvoicesService` directly (an
  unsanctioned, wrong-direction `→ billing` edge). Fixed during the 2026-08-14 architecture-review
  pass; see `Development-Standards.md` §23.
- [x] **Cross-cutting gap, resolved**: `InventoryProcurementService.listByVendor`,
  `InventoryRequisitionService.listByDepartment`, `LabWorkflowService.listByOrderItem`, and
  `OrdersService.list` used to silently return ALL tenant rows when their filter query param was
  omitted (TypeORM's `find({ where: { x: undefined } })` drops the WHERE clause entirely). Done: a
  shared `requireParam()` helper in `@hospital/pagination` now throws `BadRequestException` when
  any of the four is omitted; see
  `new/docs/superpowers/plans/2026-08-09-pagination-required-filters.md`. Along the way, also
  fixed a real pagination-clamp regression discovered during this item's review (an in-flight,
  previously-uncommitted `@hospital/pagination` library had deleted `OrdersService.list`'s
  `Math.min(limit, 100)` clamp without replacing it — `limit` was effectively unbounded for a
  window). **Deliberately excluded, staying optional:**
  `InventoryProcurementService.listStockBalances` (`itemId`) and `PatientsService.findAll`
  (`q`/`phoneNumber`/`patientNo`) — both are legitimate whole-tenant browse/search views, not "list
  one parent's children."
