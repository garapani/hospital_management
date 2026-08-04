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
5. **Deployment path + runbook fixes** (new-features.md #4 + #17) — mechanical, low-risk, same
   underlying facts from two angles (code vs. docs). Do together.

## Phase 3 — Production-readiness ops

6. **Observability stack** (new-features.md #10) — stand this up *before* load testing or
   touching auth/isolation in staging, not after.
7. **Connection pooling/tenant limits** (new-features.md #9) — direct extension of the
   pool-timeout work from the reporting-archiver session; context is fresh.
8. **Backup/restore runbooks** (new-features.md #6) **+ hardware failure recovery plan**
   (new-features.md #7) — pure ops docs, no code dependency, can run in parallel with anything
   above, but must land before any real launch (data loss = compliance issue).
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
