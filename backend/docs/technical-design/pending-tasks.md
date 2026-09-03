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
      the demo tenant already has patients). **Demo staff accounts extended (2026-09-02):** added
      `demo.helpdesk` (Helpdesk Agent), `demo.hr` (HR/Payroll Admin), `demo.audit`
      (Auditor/Compliance) — the three PRD roles the seeder had no working login for at all, found
      while manually QA-ing the 2026-09-02 role-based review's fixes (Helpdesk Agent needed a real
      account to exercise the new Assign/detail-view work). Staff-account creation is idempotent
      per username regardless of business-data state, so `nx run api:seed-rbac` +
      `nx run api:seed-demo-data` are both safe to rerun on an already-seeded tenant whenever new
      RBAC grants or demo accounts land — confirmed live against the local dev DB.
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
      absent from dev Postgres. **Follow-up (2026-08-21):** orphaned PDF-test schemas
      `tenant_lab_report_pdf_1` / `tenant_radiology_report_pdf_1` (no registry rows) dropped —
      remaining schemas (`__platform`, `demo`, `demo1`) all have registry rows.

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
- [x] **Tenant deletion & retention** (2026-08-21) — policy chosen: archive (soft-delete,
      reversible, data kept, login blocked) + purge (irreversible, archived-only, typed
      hospitalId confirmation, drops schema/role/registry row, recorded in the platform audit
      trail) + no auto-purge. Also fixed the **suspend-never-blocked-login bug** found on the
      way: login/refresh now gate on tenant status (suspended/archived → 403 tenantInactive /
      refresh invalidToken). Live-verified: suspend → login blocked, archive → blocked,
      restore → active, purge guards (active refused, wrong confirm refused) + schema/role/row
      gone, audit delete record survives, demo unaffected. Backend suite 653, frontend 320.
      See `Development-Standards.md` §47.
- [x] **Prod compose secrets are hardcoded, not env-required.** **Resolved (2026-09-03):** every
      secret-bearing field across all 6 services (`POSTGRES_PASSWORD`/`DB_PASSWORD`,
      `MINIO_ROOT_USER`/`PASSWORD`, `OBJECT_STORAGE_ACCESS_KEY`/`SECRET_KEY`, `JWT_SECRET`) now
      uses `${VAR:?Error: VAR environment variable is required}` mandatory interpolation instead
      of a literal plaintext default (`hospital_db_pwd`, `hospital_dev_password`,
      `dev-secret-key-at-least-32-chars-long-12345`) — verified with `docker compose config` both
      with the vars set (parses clean) and unset (fails immediately with the required-variable
      error, doesn't silently start). MinIO's bootstrap creds now derive from the same
      `OBJECT_STORAGE_ACCESS_KEY`/`SECRET_KEY` the API already required at boot (one source of
      truth, matching what `Deployment-Guide.md` §9 already claimed but the compose file didn't
      actually do — it had no `${VAR}` interpolation at all, so the documented `.env` file was
      never actually reaching the containers). `Deployment-Guide.md` §3's `.env` template updated
      to list `OBJECT_STORAGE_ACCESS_KEY`/`SECRET_KEY`, which it hadn't before. **Operational
      note, not yet actioned:** because the compose file never read `.env` for these fields before
      this fix, the live `newgenworks.in` deployment (§9) has been running on the literal hardcoded
      values above, not whatever the server's `.env` contains — those values are also in this
      repo's git history. Rotating the live DB/MinIO/JWT secrets on that server is a follow-up the
      human partner needs to do (and is outside what an agent should do unilaterally against a
      shared production box). Found in the 2026-09-03 external review.
- [x] **Public schema over-grant on tenant roles.** **Resolved (2026-09-03):** migration
      `0093-initial-platform-schema.ts:429-430`'s `REVOKE USAGE ON SCHEMA public FROM PUBLIC;
      GRANT ALL ON SCHEMA public TO PUBLIC;` was a raw pg_dump artifact that self-contradicted (the
      second statement undid the first and added `CREATE` on top) — since 0093 is an immutable
      squashed baseline (never hand-edited), fixed via a new appended migration,
      `0099-restrict-public-schema-grants.ts` (`RestrictPublicSchemaGrants4000000000001`, first
      platform migration since the squash — starts a new "4-prefix" sort-key block, distinct from
      the tenant side's "3-prefix" block, per `index.spec.ts`'s global-uniqueness check), which
      revokes `ALL` and re-grants only `USAGE` to `PUBLIC`. `PUBLIC` is a pseudo-role covering
      every role including future ones, so this one statement pair closes the gap for every
      already-provisioned tenant role too — no per-tenant backfill loop needed (confirmed live:
      `\dn+ public` now shows `=U/pg_database_owner`, USAGE only, no CREATE). `USAGE` deliberately
      kept, not fully revoked, so `gen_random_uuid()` (installed into `public` by 0093's
      `CREATE EXTENSION pgcrypto`, and what every tenant table's `id uuid DEFAULT gen_random_uuid()`
      depends on via the `search_path` fallback) still resolves. 2 new pinning tests in
      `tenant-connection.service.integration-spec.ts` (CREATE on public now denied; USAGE-based
      resolution still works); full suite green. Found in the 2026-09-03 external review.

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
- [x] **Unpaginated endpoints audit.** **Resolved (2026-09-03):** all 9 flagged list endpoints
      (`GET /vitals/patient/:patientId`, `GET /inventory/sub-categories/:subCategoryId/items`,
      `GET /inventory/categories/:categoryId/sub-categories`, `GET /inventory/vendors`,
      `GET /departments`, `GET /wards`, `GET /wards/:wardId/beds`, `GET /tenants`,
      `GET /platform/billing/subscriptions`) now use `@hospital/pagination`'s
      `PaginationQueryDto`/`paginate()`, returning `PaginatedResponseDto<T>`. Frontend: the two
      with a real unbounded-growth story (vitals-by-patient, inventory items-by-subcategory) and
      the remaining catalog/dropdown-style ones (departments/wards/beds/vendors/sub-categories/
      tenants) all keep their existing `Observable<T[]>` API-service signatures — each service
      requests `limit: 100` and unwraps `.data` internally, so no consuming component changed;
      `GET /platform/billing/subscriptions` has no frontend consumer yet, backend-only fix.
      Every internal backend caller (`seed-demo-data.ts`, 5 service-level + 2 controller-level
      integration specs) updated for the new response shape; 2 specs needed an explicit
      `limit: 100` where the same suite/file provisions enough rows across its own test run to
      push a just-created one past the default page-1 window. See `Development-Standards.md`
      §134. Found in the 2026-09-03 external review.

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
   question #1 (self-owned server vs. VPS) is still unresolved. **Continuous WAL/PITR and a
   self-owned-server recovery variant done (2026-08-25):** `Runbook.md` §5 documents
   `archive_mode`/`archive_command`/`archive_timeout` config, base-backup, and
   `recovery.signal`/`restore_command`/`recovery_target_time` restore-to-a-point-in-time
   procedure (opt-in, not yet enabled/drilled in any environment); §6 documents how hardware
   recovery differs on self-owned hardware (no provider snapshot — needs a cold spare or an
   accepted longer RTO; own network/power dependency; own OS/Docker provisioning), pending the
   §12 decision. **Not done:** naming a real owner/escalation contact — asked the human,
   explicitly deferred rather than left as an oversight.
9. **Reference server sizing + load test** (new-features.md #8) — only meaningful once
   observability (item 6) and pooling (item 7) are in place to measure against.
- [x] **Audit-subscriber connection pool contention.** **Resolved (2026-09-03):** unlike
      `ReportingSubscriber` (already isolated on its own `REPORTING_DATA_SOURCE` pool, see item 6),
      `PersistingAuditEventPublisher` called `runInTenantSchema()` with no override, taking a
      second connection from the same main pool (item 7, max 20) while the triggering business
      transaction still held its own. Fixed by mirroring the reporting pattern exactly: a new
      `audit-data-source.ts` (`AUDIT_DATA_SOURCE` token, `max: 3`/`connectionTimeoutMillis: 2000`,
      maps only `AuditRecord`), wired into `AuditModule` via an async factory provider +
      `onModuleDestroy` cleanup, injected into `PersistingAuditEventPublisher` and passed as
      `runInTenantSchema`'s second argument. 3 new pinning tests (dedicated pool config, routing
      through the dedicated pool not the main one, fails-fast-on-exhaustion) added to
      `persisting-audit-event-publisher.integration-spec.ts`; full suite green. See
      `Development-Standards.md` §132. Found in the 2026-09-03 external review.
- [x] **Global exception filter + correlation-id response header.** **Resolved (2026-09-03):**
      `apps/api/src/common/filters/global-exception.filter.ts` (`GlobalExceptionFilter`, registered
      via `app.useGlobalFilters` in `main.ts`) passes any `HttpException` through unchanged — every
      existing per-service `QueryFailedError` handler (role-management, appointments, lab-catalog,
      pharmacy-dispensing, accounting, ...) keeps working exactly as before — and maps two named
      Postgres SQLSTATE codes (`57014` statement timeout → 504, `23505` unique violation → 409) as
      a last-resort safety net for anything that reaches it uncaught; anything else still logs and
      returns a generic 500, just with a consistent `{statusCode, message}` body instead of Nest's
      default. `TenantContextMiddleware` now calls `res.setHeader('x-correlation-id', ...)` right
      after resolving the id (client-supplied or generated), so it lands on both success and error
      responses; `main.ts`'s CORS config gained `exposedHeaders: ['x-correlation-id']` so a browser
      client can actually read it (`allowedHeaders` alone only governs request headers). 11 new
      tests (7 unit on the filter, 4 integration proving real end-to-end wiring) plus 1 new test on
      the middleware's existing spec; all 7 tests in that spec needed a `setHeader`-mocking `res`
      fixture since they'd previously passed a bare `{}`. See `Development-Standards.md` §135.
      Found in the 2026-09-03 external review.
- [x] **Backup script/Runbook point at dev compose, not prod.** **Resolved (2026-09-03):**
      `scripts/backup-db.sh`'s `COMPOSE_FILE`/`POSTGRES_SERVICE` defaults now target production
      (`docker-compose.prod.yml`/`postgres`, the compose **service name** — not the
      `hospital-postgres` container name, which `docker compose exec` doesn't take), overridable
      for a local dev-compose test run; this matches the script's actual primary use (the
      unattended nightly cron entry on the deployed host, which never overrides these vars).
      `Runbook.md`'s full-database restore, per-tenant restore, monthly restore-drill, and PITR
      base-backup sections all updated the same way — the restore-drill intentionally still runs
      against the real production Postgres instance (proving a real prod backup restores on the
      real prod Postgres version/config), just into a throwaway `restore_drill_scratch` database,
      never the live `hospital_db`. Item 8 above already documents the backup/restore *procedure*
      as done; this was a naming-mismatch correction on top of it, not a new capability — a prod
      restore following the Runbook literally before this fix would have targeted the wrong
      compose file/service entirely. `Deployment-Guide.md`'s env-var table corrected to match.
      **Not done:** no automated nightly backup cron container in `docker-compose.prod.yml` itself
      (backups rely on `scripts/backup-db.sh` being invoked externally, e.g. host cron, which is
      how `Deployment-Guide.md` already documents it) — a genuinely different, additive capability
      from this naming-mismatch fix, left out of scope here. Found in the 2026-09-03 external
      review.

## Phase 4 — Complete near-finished features

10. [x] **Reporting dashboard read APIs** (new-features.md #13) — done: `GET /reporting/events`
    (filterable/paginated list), `GET /reporting/dashboard/event-counts` and
    `GET /reporting/dashboard/revenue` (daily aggregations), all gated by a new `reporting.read`
    permission wired to `Super Admin`/`Hospital Admin`/`Auditor/Compliance` (the latter's first-ever
    permission grant). **CSV export shipped 2026-08-20** (RFC 4180 serializer +
    `GET /reporting/events/export.csv` whole-set capped at 10000 rows + `GET /reporting/dashboard/revenue/export.csv`,
    both reporting.read-gated with attachment headers; 5 tests). **PDF export shipped
    2026-08-22:** `GET /reporting/events/export.pdf` (same filter shape as the CSV sibling,
    10000-row cap, `reporting.read`-gated, `application/pdf` attachment) reuses the shared
    `@hospital/pdf` lib — a landscape events table via a pure, unit-tested document builder
    (`reporting-events-pdf-document.ts`), matching the Lab/Radiology report builders' brand/style
    vocabulary. 6 new tests (3 pure builder + 3 export). See `Development-Standards.md` §49.
- [x] **Billing: invoice PDF/print.** **Resolved (2026-09-03):** `GET
      /billing/invoices/:id/invoice.pdf` (`billing.read`-gated, `Content-Disposition: inline`)
      renders a patient invoice/receipt PDF via a new `InvoiceExportService` + pure
      `buildInvoicePdfDocument` builder, mirroring the Lab/Radiology report PDF pattern — kept off
      `InvoicesService`'s own constructor (directly `new`'d in 4 integration specs) per
      Development-Standards.md §131's pattern. Frontend: a "Print Invoice" button on the invoice
      detail screen opens it via `openPdfBlobInNewTab` (view/print, not a forced download),
      matching the Lab requisition detail screen's "View Report" button. 6 new tests (4 pure
      builder, 2 integration on the backend; 2 more on the frontend component); full suites green.
      Found in the 2026-09-03 external review.

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
13. [x] **India compliance roadmap** (new-features.md #14) — product-scoping work, not blocking
    engineering. **Done 2026-08-22:** `india-compliance-roadmap.md` — a 9-item gap checklist
    (DPDP Act consent/data-subject-rights/breach-notification, medical-records retention,
    disease-reporting, PM-JAY, ABHA, ESI/PF) with current-state, modules-touched, and a priority
    signal per row, plus a "what's already in place" inventory (data residency, audit trail,
    log redaction, tenant archive/purge as an erasure primitive, DB-level tenant isolation, GST
    invoicing) and a note that GST landed inline in Billing rather than as the PRD's originally
    envisioned separate India Compliance Adapter module. No code changes — a scoping document, to
    be pulled from when a real requirement (tenant ask, accreditation audit, regulator change)
    makes one of its rows actionable.
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
- [x] **Platform subscription/billing (option 2)** (2026-08-21) — the platform's own SaaS billing
      for hospital tenants: `platform-billing` module (public schema, migration `0051`,
      `system-admin.tenants.manage`-gated) manages per-tenant `subscriptions` (package, billing
      cycle, denormalized price-per-cycle, current period) and `subscription_invoices` (manual
      issue against the current period, one open invoice per period, mark-paid advances the
      period — the renewal mechanism). Prices live on `PACKAGE_CATALOG` (`priceMonthly`/
      `priceAnnual` per edition). Frontend: a Billing panel on the platform console's tenant
      detail page (subscription card + invoices table, Subscribe/Update-cycle/Cancel/Issue
      Invoice/Mark Paid), backed by a dedicated `SubscriptionsApiService`. Live-verified end to
      end against the demo tenant (subscribe → issue ₹4,999 invoice → duplicate 409 → mark paid,
      period advanced → cancel). See `Development-Standards.md` §48. **Not done:** a self-serve
      upgrade/payment path (product chose platform-admin-only, manual invoicing — same ruling as
      package changes), and seeding a demo subscription in `seed-demo-data.ts`.

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
    review). **Scoping note done (2026-08-25):** see
    `new/docs/superpowers/specs/2026-08-25-dicom-scoping-design.md` — open questions on
    ingest path, storage (proposed: reuse `@hospital/object-storage`/MinIO, not blob-in-DB
    like the legacy PACS DB), link to Radiology requisitions, and viewer scope. No code yet;
    blocked on human picking scope answers. **Ward Supply is done (2026-08-20):** ward sub-store stock
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
  tests pass; production build succeeds (commit `b89ad01` in the frontend repo). **Correction
  (2026-08-22):** a notifications page (list + mark-read/mark-all-read + the shell's notification
  bell wired to `GET /notifications/summary`) and vitals/encounters pages (patient-scoped vitals
  entry; notes/diagnoses/prescriptions tabs) turned out to already be built and routed too — this
  line was stale, found and corrected while picking up `claude-code-tasks.md` 2.6. **Patient-portal
  Phase 1 backend done (2026-08-23):** patient login + read-only self-scoped records (appointments,
  invoices, prescriptions, lab/radiology results) — see `claude-code-tasks.md` 2.6 and
  `Development-Standards.md` §62. **Not built:** the `patient-portal` frontend app scaffold, and
  Phase 2-4 (booking, payment, messaging) — each a distinct follow-up needing its own scope
  confirmation, payment additionally blocked on a gateway-vendor decision.
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
    adapter per PRD §5.7), payer-side settlement reconciliation. **Frontend page shipped
    2026-08-22** (separate repo `frontend/`): a Payers/Policies/Claims tabbed page
    (`apps/staff-console/src/app/insurance/`) — payer master list/create/edit/deactivate,
    patient policy list/create/deactivate with a Check Coverage action, and the claims list with
    the full status-machine actions (Submit/Approve/Reject/Mark Paid), gated by
    `insurance.read`/`insurance.manage` and a permission-driven nav entry. 15 new frontend tests;
    full claims lifecycle (payer → policy → coverage check → claim → submit → approve → pay)
    live-verified end to end against the dev API. See `Development-Standards.md` §50.
  - **Accounting (2026-08-20):** `accounting` module — hierarchical chart of accounts
    (Asset/Liability/Equity/Income/Expense + soft-delete), double-entry journal entries (balanced
    lines, `Draft -> Posted` immutable, auto `JRN-…` numbers, actor-derived createdBy/postedBy per
    §25), and read-only financial reports: trial balance (per-account debit/credit totals), income
    statement (revenue − expenses = net income), and balance sheet (assets = liabilities + equity
    + retained earnings). Permissions `accounting.read`/`accounting.manage` wired to Billing/
    Accounts Staff, Hospital Admin, Super Admin. Migration `0035`; 7 integration tests (reports
    tested hermetically in a dedicated tenant). **Frontend page found already shipped, and its
    reports given CSV/PDF/Excel export (2026-09-02):** the "no frontend page" note below was stale
    by the time this landed — `accounting-console.ts` (Chart of Accounts / Journal Entries /
    Reports tabs) already existed. Added the missing piece: export buttons on the Reports tab,
    routed to nine new `accounting.read`-gated endpoints (`reports/{trial-balance,income-statement,
    balance-sheet}/export.{csv,pdf,xlsx}`), all passing the same from/to/asOf filters the on-screen
    report already uses. `AccountingExportService` is deliberately a separate service from
    `AccountingService` — see `Development-Standards.md`. Not done (future items): automatic
    journal posting from Billing/charge-capture (ledger mapping — the old system's
    `DanpheEMR.AccTransfer`), reversing/correcting posted journals, fiscal-year closing, account
    reconciliation.
  done for its MVP register scope (2026-08-20):** `fixed-assets` module with asset categories +
  asset register (auto asset codes, purchase date/cost, supplier, department assignment,
  condition In Service/Under Repair/Retired), paginated list, update, soft-delete
  (deactivate/reactivate, §28 convention), and read-time straight-line depreciation
  (`GET /fixed-assets/:id/valuation` — accumulated + book value; stateless, no accrual job).
  Permissions `fixed-asset.read`/`fixed-asset.manage` wired to Super Admin / Hospital Admin /
  Inventory & Store Manager. Migration `0033`. **Depreciation accrual done (2026-08-25):** see
  `claude-code-tasks.md` 2.9 / `Development-Standards.md` §65. Not done (future items):
  disposal/write-off, asset transfers between departments, maintenance/AMC tracking, and a
  frontend page (including one for the new accrual endpoints).
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
- Phase 6: Document and Print, full Reporting/Dashboard — **first slice done (2026-09-02):**
  patient ID label printing — `GET /patients/:id/id-label.pdf` (a 4in x 2in wristband/file-folder
  label: name, patient number, gender/DOB, blood group, QR-encoded patientId), `patients.read`-
  gated, via the existing `@hospital/pdf` lib (no new dependency — pdfmake's built-in QR support,
  no separate barcode library needed). Frontend: a "Print ID Label" button on Patient Detail opens
  it in a new tab for the browser's native print dialog. This is also the first binary (non-JSON)
  download anywhere in this frontend — `ApiClientService` gained `getBlob()` for it, additive, every
  existing `get<T>()` caller unaffected. **Second slice done (2026-09-02):** Lab specimen label
  (`GET /lab/requisitions/:id/specimen-label.pdf`) and Radiology requisition label
  (`GET /radiology/requisitions/:id/requisition-label.pdf`) — same small-label pattern, QR-encoded
  requisitionId, available before collection/scan (that's when the label actually gets attached to
  the tube/envelope). `openPdfBlobInNewTab()` extracted to `shared/pdf-blob.util.ts` now that three
  screens (Patient Detail, Lab/Radiology Requisition Detail) share it. **Third slice done
  (2026-09-02):** Pharmacy dispensing label (`GET /pharmacy/dispensings/:id/dispensing-label.pdf`)
  — same pattern, QR-encoded dispensingId, available before dispensing. All four label types
  named in the 2026-09-02 role-based review are now shipped. **Reporting fully closed out
  (2026-09-02):** the Lab/Radiology `report.pdf` and Reporting CSV/PDF export endpoints (flagged
  above as having no frontend button anywhere calling them) now have one — "View Report" on both
  requisition detail screens (Verified-status only, matching the backend's own gate), and
  CSV/PDF/Excel export buttons on the Reporting Dashboard's Events/Revenue panels. Excel export
  shipped as a new `@hospital/excel` platform lib (exceljs-backed, mirrors `@hospital/pdf`'s
  thin-wrapper shape) — also used for a third export format on the accounting reports below. The
  full Reporting/Dashboard aggregation UI (charts/summaries beyond the existing event-counts and
  revenue panels) remains open, not blocked on anything. **Helpdesk**, **Marketing
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
- [ ] **Cashier shift open/close + day-end reconciliation.** No `CashierShift`/settlement entity,
  service, or endpoint exists. Hospital billing-desk cashiers handling 8-hour shifts of
  cash/UPI/card need: open shift with a float amount, accept payments through the shift, submit a
  physical cash-denomination count + card/UPI slip count at close, and a day-end reconciliation
  report flagging overage/shortage before handoff to accounts. Found in the 2026-09-03 external
  review.
- [ ] **Payment transaction reference fields.** `payment.entity.ts`/`RecordPaymentDto` have no
  `transactionReference`/`upiRefNumber`/`bankName`/`chequeNumber` fields — bank reconciliation and
  finance audit can't match a hospital payment record against the corresponding bank-statement
  line. Found in the 2026-09-03 external review.
- [ ] **Global patient search (Ctrl+K).** No command-palette/spotlight component exists in
  `staff-console`. Receptionists/triage nurses handling queues and phone calls currently must
  navigate to the patients list and filter — a top-bar spotlight search over `/patients?q=`/
  `/directory/resolve` (phone, UHID, name) from any screen would remove that detour. Found in the
  2026-09-03 external review.
- [ ] **Unified doctor consultation pad.** The OPD clinical workflow is split across 4 separate
  routes (`/clinical/patients/:id`, `/clinical/vitals`, `/clinical/encounters`, `/clinical/orders`)
  with no single-screen view — a doctor must leave the encounter, re-search the patient, and order
  tests/prescriptions separately; prescriptions are plain text with no pharmacy stock check. This
  is a larger UX redesign, not a small gap — worth scoping as its own design pass (patient summary
  + SOAP notes/diagnosis + order/prescription drawer in one screen) rather than a quick fix. Found
  in the 2026-09-03 external review.

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
