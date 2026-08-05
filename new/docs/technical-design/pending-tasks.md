# Pending Tasks — Recommended Order

Source material: `new-features.md` (gap list) and `review-comments.md` (evidence, file:line
references). This document sequences those items by priority and dependency, not by the order
they were discovered.

**Ordering principle:** security gaps in a multi-tenant hospital EMR outrank everything else —
every day live with header-trusted auth/tenant resolution is real exposure. After that: cheap
guardrails that prevent the remaining backlog from making things worse, then ops-readiness, then
feature completion, then net-new platform work, then the multi-quarter product backlog last (it
follows the PRD's own phase order — no reason to re-litigate that).

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
   coverage for this item afterward.

## Phase 2 — Guardrails while the backlog grows

4. [x] **Nx module-boundary lint** (new-features.md #3) — done: `@nx/enforce-module-boundaries`
   tags the 4 real Nx projects, `eslint-plugin-boundaries` tags the domain folders inside
   `apps/api`, both wired into CI via the `lint` target.
5. [x] **Deployment path + runbook fixes** (new-features.md #4 + #17) — done: `Deployment-Guide.md`
   and `Runbook.md` now match the real env var names, build output path, start command, and
   migration behavior (not automatic; platform vs. tenant migrations; `migrate-tenants` target);
   also documents that `migrate.ts`/`migrate-tenants.ts` currently can't be invoked outside Jest
   (tsx/ts-node decorator-parsing issue through `libs/audit-emitter` — a new, previously-unknown
   tooling gap, not just a doc-wording fix) and that no production Dockerfile/`docker-compose.yml`
   exists yet. Also fixed the Runbook's `afterTransactionCommit`/rollback-sandbox claims, which
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
   the main `DataSource`. Per-tenant caps (needs PgBouncer — grouped with the existing missing
   production Dockerfile/`docker-compose.yml` gap) and tenant-tagged metrics/alerts (needs the
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

## Phase 6 — Product module backlog

Follow the PRD's own phase ordering as-is:

- Phase 2:
  - [x] Lab/LIS core pipeline (test catalog, requisition/sample tracking, result entry,
        single-level verification) — done. **Not done:** report/PDF export, machine/instrument
        (LIS) integration, external lab send-out, government disease-reporting mapping,
        multi-level verification, catalog update/delete (create+list only shipped; see
        `Development-Standards.md` §14), result amendment history/audit trail (corrections
        currently overwrite in place with no version row — acceptable for now since only
        pre-verification edits are allowed, but named explicitly rather than left silent), and
        `OrderItem.status` never advancing when its lab requisition is verified (the ordering
        doctor has no signal from the Order module itself that results are ready; they'd need to
        check Lab directly) — each a distinct future item.
  - [x] Radiology core pipeline (imaging catalog, requisition/scan tracking, single-field report
        entry, single-level verification) — done. **Not done:** image attachment
        (`@hospital/object-storage` integration), film type/quantity billing tracking, DICOM
        integration (confirmed a wholly separate old-system domain — its own models, own
        controller), report template HTML rendering/PDF export, catalog update/delete (create+list
        only, same scope cut as Lab), result amendment history/audit trail, and `OrderItem.status`
        never advancing on verification (same two gaps Lab has, named here rather than left
        silent) — each a distinct future item. Request-body validation for the required workflow
        fields (`reportText`, `reportEnteredBy`, `scannedBy`, `verifiedBy`) is now enforced by
        explicit service-layer guard clauses plus database CHECK constraints (added in a final-review
        fix), closing a gap where an empty/malformed request body could previously have produced a
        `Verified` report with NULL text/author.
  - DICOM, Pharmacy, Inventory, Ward Supply — not started
- Phase 3: Insurance/Claims, Accounting, Verification, Fixed Asset
- Phase 4: Clinical/EMR long tail, Nursing, Emergency, OT, Maternity, CSSD
- Phase 5: Employee, Payroll, Fraction and Incentive
- Phase 6: Helpdesk, Marketing and Referral, Social Service Unit, Notification, Document and
  Print, full Reporting/Dashboard

## Dependencies worth calling out explicitly

- **Phase 3, item 9** (load test) should follow items 6–7, not precede them.
- **New gap, not yet its own item**: neither `apps/api/src/database/migrate.ts` (platform
  migrations) nor `migrate-tenants.ts` (tenant migrations) can currently be invoked outside Jest —
  both fail under `tsx` and `node --loader ts-node/esm` with a decorator-parsing error surfacing
  through `libs/audit-emitter`. The underlying migration logic is proven correct (passes under
  Jest), so this is a standalone-script tooling fix (decorator-safe runner or a build step), not a
  logic fix. Should land before any real deployment — bundle with Phase 3 ops-readiness work.
- **New gap, not yet its own item, codebase-wide**: every domain module's "actor" DTO fields
  (`enteredBy`, `verifiedBy`, `sampleCollectedBy` in Lab, Radiology's `scannedBy`/`reportEnteredBy`/
  `verifiedBy`, and the pre-existing `orderedBy`/`dischargedBy`/`transferredBy` elsewhere) are
  client-supplied in the request body
  rather than derived from the authenticated principal (`request.authContext`), so any caller
  holding the right permission can attribute an action to a different, arbitrary user ID. Most
  severe for Lab's `verifiedBy` (a clinical sign-off), but this is a pattern across the whole
  codebase, not a Lab-specific defect — worth its own future item to derive these fields from
  `authContext` instead of trusting the body, across every domain, not just Lab.
- **New gap, not yet its own item**: one test in
  `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts` (the
  "SQL-level failure gets logged" assertion around its `loggedErrors` spy on
  `Logger.prototype.error`) fails consistently as of the Phase 5 item 11 work — confirmed
  unrelated to that work (reproduces identically with those changes fully reverted). Not
  investigated further; worth a focused look, possibly related to the structured-logging change
  (Phase 3 item 6) altering how/whether `Logger.prototype.error` gets called once
  `app.useLogger()` is active.
