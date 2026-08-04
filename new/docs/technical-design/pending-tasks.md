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

10. **Reporting dashboard read APIs** (new-features.md #13) — the event archiver is
    capture-only as of the reporting-archiver session; finishing the read side is the shortest
    path to a shippable feature.

## Phase 5 — New platform capabilities

11. **Redis integration** (new-features.md #11) — pairs naturally with item 3's permission-check
    rework; do it while that code is already open.
12. **MinIO/object storage integration** (new-features.md #12) — independent, no urgency driver.
13. **India compliance roadmap** (new-features.md #14) — product-scoping work, not blocking
    engineering.

## Phase 6 — Product module backlog

Follow the PRD's own phase ordering as-is:

- Phase 2: Lab/LIS, Radiology, DICOM, Pharmacy, Inventory, Ward Supply
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
