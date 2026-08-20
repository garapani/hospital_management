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
      catalog pricing) — full suite 389 passed. See `Development-Standards.md` §27. Known
      follow-ups: no re-run mechanism for a capture that fails at the SQL layer (rare — the error is
      logged; a "re-run capture for a completed order item" endpoint is a future item), and the
      find-open-invoice-then-append step is not row-locked (a concurrent first-capture race could
      create two invoices — same future item).
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

## Phase 0 — Housekeeping

- [x] Commit `new-features.md`, `review-comments.md`, the `PRD.md` move, and the new ADR
      (`276d5ac`)
- [x] Fix moved-path references (new-features.md #16) — bundled into the same commit
      (`276d5ac`)
- [ ] Manual cleanup left over from the reporting-archiver session: delete the stale
      `worktree-feat-reporting-archiver` branch, drop the `scratch_rep_check` schema in local dev
      Postgres (both blocked by `guard-destructive.sh`, need to be run by hand)

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
   rest of this item — Prometheus metrics, OpenTelemetry tracing, Grafana/Loki dashboards and
   alert rules — is **not done** and needs its own future item before load testing (item 9) or
   touching auth/isolation in staging, since those still depend on metrics/tracing, not just logs.
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
    permission grant). **Not done:** export endpoints (CSV/PDF for government/operational reports)
    — deferred, open product-scoping question on formats/audience.

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
    local dev MinIO container. **Not done:** upload/download REST endpoints (deferred — no domain
    module produces or consumes files yet; the first real consumer wires directly against
    `ObjectStorageService`) and an actual backup script (deferred — nothing to back up yet;
    `Runbook.md` §7 documents the policy for when one exists).
13. **India compliance roadmap** (new-features.md #14) — product-scoping work, not blocking
    engineering.
14. [x] **Platform (Super Admin) console above tenants.** Super Admin accounts moved out of the
    `demo` hospital into a reserved `__platform` system tenant; `staff-console` split into a platform
    console (`/platform/*`, `PlatformShell`) and the tenant console (`AppShell`), guarded by
    `platformGuard`/`tenantGuard` and reached at `admin.*` vs. the bare host. Platform users have no
    access to tenant data — enforced structurally by JWT-derived schema resolution, not by new
    per-endpoint guards. Spec: `new/docs/superpowers/specs/2026-08-13-platform-superadmin-console-design.md`.
    Plan: `new/docs/superpowers/plans/2026-08-13-platform-superadmin-console.md`.

## Phase 6 — Product module backlog

Follow the PRD's own phase ordering as-is:

- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. **Not done:** report/PDF export, machine/instrument
        (LIS) integration, external lab send-out, government disease-reporting mapping,
        multi-level verification, result amendment history/audit trail (corrections
        currently overwrite in place with no version row — acceptable for now since only
        pre-verification edits are allowed, but named explicitly rather than left silent) — each a
        distinct future item. ~~`OrderItem.status` never advancing when its lab requisition is
        verified~~ **closed 2026-08-20:** verification now routes through
        `OrdersService.completeItemInTransaction`, so the `OrderItem` advances to `Completed` at
        the same time (the ordering doctor gets the signal from the Order module).
  - [x] Radiology core pipeline (imaging catalog, requisition/scan tracking, single-field report
        entry, single-level verification) — done. **Not done:** image attachment
        (`@hospital/object-storage` integration), film type/quantity billing tracking, DICOM
        integration (confirmed a wholly separate old-system domain — its own models, own
        controller), report template HTML rendering/PDF export, result amendment history/audit
        trail — each a distinct
        future item. ~~`OrderItem.status` never advancing on verification~~ **closed 2026-08-20:**
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
  - DICOM, Ward Supply — not started
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
- Phase 4: Clinical/EMR long tail, Nursing, Emergency, OT, Maternity, CSSD
- Phase 5: Employee, Payroll, Fraction and Incentive
- Phase 6: Helpdesk, Marketing and Referral, Social Service Unit, Document and Print, full
  Reporting/Dashboard — not started. **Notification** is now started/done as a slice ahead of its
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
