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

1. **Shared `inTenant()` test helper** (new-features.md #5) — build *before* item 3. Proving
   tenant isolation requires reliable, consistent test infrastructure; building the helper after
   item 3 lands would mean rewriting its isolation tests.
2. **JWT-backed request auth** (new-features.md #1) — root cause. Every protected route
   currently trusts client-controlled `x-tenant-id`/`x-permissions` headers for identity *and*
   tenant. Everything downstream (permission checks, tenant context) is built on top of this.
3. **Database-enforced tenant isolation** (new-features.md #2) — defense-in-depth: catches
   tenant-resolution bugs even after item 2 lands. **Blocked on the parked tenant-migration-runner
   gap** (see Dependencies below) — new schema grants can't be rolled out to already-provisioned
   tenants without one.

## Phase 2 — Guardrails while the backlog grows

4. **Nx module-boundary lint** (new-features.md #3) — cheap (ESLint config + Nx project tags +
   CI target). Land it before the Phase 6 backlog adds ~15 more modules, not after.
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

- **Phase 1, item 3** (DB-enforced tenant isolation) depends on solving the tenant-migration-runner
  gap first: no runner in this codebase applies migrations across already-provisioned tenant
  schemas, for any of the 17 migrations that exist today (confirmed during the reporting-archiver
  session — `apps/api/src/database/migrate.ts` only runs migrations against the default search
  path). Adding schema grants via a new migration inherits this same gap.
- **Phase 1, item 1** must precede item 3, not follow it (see above).
- **Phase 3, item 9** (load test) should follow items 6–7, not precede them.
