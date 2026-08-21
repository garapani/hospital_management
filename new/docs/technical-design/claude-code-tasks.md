# Claude Code Task Backlog — new_hospital

Actionable task list for Claude Code sessions. Each task has a short write-up:
**Context** (why it matters), **What to do** (concrete steps + file paths), **Verify**
(how to prove it works), and **Test** (exact commands). Read `CLAUDE.md` at the repo
root and `new/code/CLAUDE.md` first — they are authoritative for conventions. Work on
`main`, one feature commit per task, conventional-commit prefixes, **no `--amend`**, no
AI attribution trailers.

Two git repos, never mix them in one commit:
- **Backend + docs** — this repo (`new_hospital`). Backend code under `new/code`.
- **Frontend** — SEPARATE repo at `frontend/` (a nested git repo, ignored by the root
  `.gitignore`). Commit from inside `frontend/` with `cd frontend && git add ...`.

---

## 0. Environment quickstart

```bash
# Dev dependencies (docker): api-postgres-dev :5433, api-redis-dev :6380, api-minio-dev :9002/9003
docker start api-postgres-dev api-redis-dev api-minio-dev

# Backend unit/integration suite (full): ~664 tests, ~6-9 min
cd new/code && CI=true pnpm exec nx run api:test
# Focused: add -- --testPathPatterns="pattern"
cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="platform-billing|subscription-billing"

# Backend typecheck
cd new/code && CI=true pnpm exec nx run-many -t typecheck

# Backend dev server (restart after backend code changes; it does NOT hot-reload reliably)
cd new/code && CI=true pnpm exec nx serve api        # http://localhost:3000

# Migrations (platform schema): run after adding a platform migration
cd new/code && CI=true pnpm exec nx run api:migrate
# Tenant schemas backfill
cd new/code && CI=true pnpm exec nx run api:migrate-tenants

# Frontend tests / build (frontend repo)
cd frontend && CI=true pnpm exec nx run staff-console:test
cd frontend && CI=true pnpm exec nx run staff-console:build

# Frontend dev server (user runs this separately): ng serve on :4200
```

**Credentials (dev):** `superadmin / SuperAdmin@123!` (platform tenant `__platform`),
`demoadmin / DemoAdmin@123!` (tenant `demo`, basic package), staff `demo.* / Demo@123!`.
Demo tenant is seeded (patients, a ₹752 invoice, employees, payslips).

**Key architecture facts (do not violate):**
- Per-tenant Postgres schema `tenant_<id>` + `NOLOGIN` role; all tenant data access goes
  through `TenantConnectionService.runInTenantSchema` (real transaction, `SET LOCAL ROLE`).
- Platform tables (tenants registry, roles, packages, **subscriptions, subscription_invoices**)
  live in the `public` schema. `__platform` tenant is reserved/exempt from package filtering.
- JWT permissions are package-gated at login/refresh (`PackagesService.filterPermissions`).
  `system-admin.tenants.manage` and `rbac.manage` are **Super Admin only**.
- Audit records: `audit_records` in the tenant schema, written by a dedicated connection.
- **Test flakiness:** the full backend suite has pre-existing parallel-load flakes on the
  shared dev DB (random unrelated suites fail in some full runs, green on repeat / alone).
  Do NOT chase a full-suite failure as a regression — re-run the failing spec alone first.

---

## 1. In-flight — finish first (highest priority)

**Status (2026-08-21): all four items below are done and committed.** Backend billing module
committed (`942c041`), frontend global-catalog work committed (`57cc2cc`), Billing panel built +
committed (`3011297`), docs updated (`Development-Standards.md` §48, `pending-tasks.md` Phase 5)
and dev server restarted on the new module — live-verified end to end (subscribe → issue invoice
→ duplicate 409 → mark paid, period advanced → cancel). Left in place below as a record of what
was done; pick up from §2 (Pending tasks) next.

### 1.1 Platform subscription/billing — frontend "Billing" panel on tenant detail
**Status: done (2026-08-21), committed `3011297`.** Left below as a record of the original
task write-up.

**Context:** the platform now has SaaS billing (option 2). Platform sells packages
(basic ₹4,999/mo or ₹54,000/yr; standard ₹9,999/₹108,000; enterprise ₹19,999/₹216,000 —
prices in `package-catalog.ts`), and `platform-billing` manages per-tenant subscriptions +
manually-issued invoices. The Super Admin console's tenant detail page has Archive/Restore/
Purge but **no Billing panel** — so there is no UI to subscribe a tenant, issue an invoice,
or record payment. This is the only remaining piece of the feature.

**What to do:**
- Backend is done — inspect it first:
  `new/code/apps/api/src/platform-billing/` (`platform-billing.controller.ts` routes,
  `subscription-billing.service.ts`, `entities/`, `dto/subscribe-tenant.dto.ts`),
  migration `new/code/apps/api/src/database/migrations/0051-create-subscription-billing.ts`.
- Frontend (repo `frontend/`): add a "Billing" panel to
  `apps/staff-console/src/app/tenants/tenant-detail/` (`tenant-detail.ts` + `.html` +
  `.spec.ts`). Follow the existing pattern of the Platform-history / Roles panels there.
- Add API methods. Either extend `apps/staff-console/src/app/tenants/tenants-api.service.ts`
  or add a `subscriptions-api.service.ts`. Endpoints (all `system-admin.tenants.manage`):
  - `GET /platform/billing/subscriptions` — all subscriptions
  - `GET /platform/billing/tenants/:hospitalId/subscription` — active subscription or 404
  - `POST /platform/billing/tenants/:hospitalId/subscribe` — body `{ billingCycle: 'monthly'|'annual' }`
  - `POST /platform/billing/tenants/:hospitalId/cancel` — cancel subscription
  - `POST /platform/billing/tenants/:hospitalId/invoices` — issue invoice for current period
  - `GET /platform/billing/tenants/:hospitalId/invoices` — list invoices for the tenant
  - `POST /platform/billing/invoices/:invoiceId/paid` — mark paid (advances the period =
    renewal; one open invoice per period, duplicate issue → 409)
- Panel content: subscription card (package, cycle, price/cycle, current period start/end,
  status active|canceled) with Subscribe/Update-cycle/Cancel actions; invoices table
  (period, amount, status open|paid, issued/paid dates) with Issue Invoice + Mark Paid
  buttons. Use `MessageService` toasts (PrimeNG `<p-toast>` is global), no `alert`/`confirm`.
  `ApiClientService` has **no DELETE-with-body** — actions are POST/PATCH only.
- Remember: this is platform-side (public schema) — the hospital tenant never sees it.
- Write/extend `tenant-detail.spec.ts` to cover the new panel (mock the API, assert render
  and action calls). Follow the existing spec's harness style.

**Verify:** frontend spec passes; `staff-console:build` succeeds; live flow against the
dev API: subscribe demo tenant (monthly) → issue invoice (open ₹4,999) → mark paid
(paid + period advanced) → duplicate issue 409 → cancel. Then commit **frontend repo**
and **backend repo** separately (backend commit covers the uncommitted billing module —
see 1.2).

**Test:**
```bash
cd frontend && CI=true pnpm exec nx run staff-console:test -- --testPathPatterns="tenant-detail"
cd frontend && CI=true pnpm exec nx run staff-console:build
cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="platform-billing|subscription-billing"
```

### 1.2 Commit the uncommitted backend billing module
**Status: done, committed `942c041`.**

**Context:** `git status` in `new/code` shows modified `app.module.ts`, `data-source.ts`,
`database/migrations/index.ts`, `packages/package-catalog.ts` (prices) and untracked
`database/migrations/0051-create-subscription-billing.ts` + `platform-billing/`.

**What to do:** one `feat(platform-billing): ...` commit with explicit paths (the
auto-committer may grab in-flight work with a garbled message — add quickly):
```bash
cd new/code && git add apps/api/src/platform-billing apps/api/src/database/migrations/0051-create-subscription-billing.ts \
  apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts \
  apps/api/src/packages/package-catalog.ts apps/api/src/app/app.module.ts
git commit -m "feat(platform-billing): subscriptions + invoices (subscribe/cancel/issue/mark-paid)"
```

**Verify:** `git status` clean of those files; `git log --oneline -1` shows the commit.

### 1.3 Commit the uncommitted frontend global-catalog work
**Status: done, committed `57cc2cc`** (frontend repo). Spec confirmed green (5/5) before commit.

**What to do:** commit from inside the frontend repo:
```bash
cd frontend && git add apps/staff-console/src/app/global-catalog apps/staff-console/src/app/master-data/master-data-api.service.ts
git commit -m "feat(staff-console): global catalog edit + deactivate/reactivate"
```

**Verify:** `git status` clean; spec still green (`--testPathPatterns="global-catalog"`).

### 1.4 Docs + dev-server refresh
**Context:** after 1.2, the running dev server (`nx serve api`, background job) predates the
billing module — **restart it** so live verification hits the new routes. Also finish the
docs pipeline for the billing feature: add `Development-Standards.md` §48 (platform
subscription/billing pattern — public-schema platform billing, price source of truth in
package catalog, manual invoice issue + mark-paid-advances-period renewal, one open invoice
per period) and check off the new item in `pending-tasks.md` (Phase 5).

**What to do:** kill the old serve job, start a new one; write §48; update
`pending-tasks.md`; commit `docs:` (root repo). Also update `mvp-status.md` only if the
audit picture shifts.

**Test:** `curl -s localhost:3000/platform/billing/subscriptions -H "Authorization: Bearer <superadmin-token>"` returns JSON, not 404.

---

## 2. Pending tasks (backlog, from `pending-tasks.md`)

### 2.1 Reference server sizing + load test (Phase 3 item 9)
**Context:** blocked on observability (done) + pooling (done) — now actionable. PRD needs a
reference VPS sizing (CPU/RAM/disk) for the Hostinger path and a load test to back it.
**What to do:** `k6` or similar against the dev API (`/metrics` + structured logs as
measurement), model: login → patient list → appointment create → invoice flow. Document
numbers in `Runbook.md`; add sizing table to `Deployment-Guide.md`.
**Verify:** a repeatable load-test script in `scripts/` + a documented sizing table.
**Test:** run the script, record p50/p95 and error rate.

### 2.2 Observability remainder: tracing + dashboards (Phase 3 item 6)
**Context:** structured logging + Prometheus metrics are done; OpenTelemetry tracing and
Grafana/Loki dashboards + alert rules are explicitly **not done**.
**What to do:** add OTel (or at minimum a trace-id propagation contract), plus a
`deploy/grafana/` provisioning folder with dashboards for the existing `/metrics` and
alert rules (5xx rate, tenant-schema errors, statement timeouts). Wire into
`docker-compose.prod.yml` like the existing prometheus service.
**Verify:** docker-compose prod brings up grafana with a working datasource and dashboards.
**Test:** `docker compose -f docker-compose.prod.yml config` passes; dashboards import cleanly.

### 2.3 Per-tenant connection caps + tenant-tagged metrics (Phase 3 item 7)
**Context:** global pool max + statement timeout done; per-tenant caps need PgBouncer
and tenant-tagged metrics/alerts need the observability stack (now exists).
**What to do:** evaluate PgBouncer in the prod compose (or document the decision);
add `tenantId` label to the existing HTTP histogram where available; add an alert on
per-tenant pool saturation.
**Verify:** metrics carry tenant labels; a documented PgBouncer path.
**Test:** `curl localhost:3000/metrics | grep tenant`.

### 2.4 WAL/PITR + self-owned-server runbook (Phase 3 item 8)
**Context:** nightly `pg_dump -Fc` + 30-day retention done; 24h RPO accepted. Continuous
WAL/PITR, a self-owned-server recovery runbook, and a named owner/escalation contact are
explicitly **not done**.
**What to do:** add `archive_mode`/`archive_command` guidance + restore-from-WAL procedure
to `Runbook.md`; write the self-owned-server variant; fill in the owner placeholder (ask
the human for the name).
**Verify:** Runbook has both recovery paths and no unresolved placeholder.
**Test:** n/a (doc-only).

### 2.5 Reporting PDF export (Phase 4 item 10)
**Status: done (2026-08-22).** See `Development-Standards.md` §49.

**Context:** CSV export shipped (RFC 4180, `reporting.read`-gated); PDF explicitly deferred.
The `@hospital/pdf` lib exists (pdfmake) — Lab/Radiology already render verified-report PDFs.
**What to do:** add `GET /reporting/events/export.pdf` (same filter shape as CSV) reusing
`@hospital/pdf`; `reporting.read` gate; `application/pdf` attachment.
**Verify:** endpoint returns `%PDF-` magic bytes for a filtered export; 403 without the
permission.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="reporting"`.

### 2.6 Frontend pages still missing (Phase 6 note)
**Context:** tenant console pages built for Lab/Radiology/Pharmacy/Inventory/Admissions/
Orders/Reporting. **Not yet built:** a notifications page (feature folder exists, no routed
page), vitals/encounters pages, and patient-portal.
**What to do (pick one):** build the notifications page first (backend module + in-app
subscribers exist: CRUD, summary, mark-read/mark-all-read; wire into the shell's
notification bell). Then vitals/encounters (encounters module exists backend-side). Patient
portal is a bigger product decision — confirm scope with the human before starting.
**Verify:** routed page renders real data from the API; no fake data; toasts on actions.
**Test:** `cd frontend && CI=true pnpm exec nx run staff-console:test && CI=true pnpm exec nx run staff-console:build`.

### 2.7 Insurance frontend page (Phase 3)
**Context:** `insurance` module complete (payers, policies, claims lifecycle, coverage
check) with **no frontend page**.
**What to do:** payer master list/create, patient policy view, claims list with the
status-machine actions (submit/approve/pay/reject), coverage check display. Follow the
Reporting-page patterns in the frontend repo.
**Verify:** full claims flow clickable against the dev API; permission-driven menu entry.
**Test:** frontend spec + build.

### 2.8 Accounting auto-posting from Billing (Phase 3)
**Context:** accounting module done (CoA, double-entry journals, reports); automatic journal
posting from Billing/charge-capture (ledger mapping — legacy `DanpheEMR.AccTransfer`) is
explicitly **not done**.
**What to do:** design a ledger mapping (revenue accounts per item type / cash vs. credit)
and post a journal when an invoice payment is recorded. This touches money — follow the
risk-gated review rule (security-review/code-review at high effort before merge).
**Verify:** a recorded payment produces a balanced posted journal; reports reflect it.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="accounting"` (+ new tests).

### 2.9 Fixed-assets depreciation schedules (Phase 3)
**Context:** read-time straight-line depreciation exists; periodic accrual schedules,
disposal/write-off, transfers, maintenance/AMC tracking are **not done**.
**What to do:** pick the smallest valuable slice — depreciation schedule/accrual job
(stateless read → scheduled accrual). Confirm scope with the human (each is a distinct
future item).
**Verify:** schedule records + accrued amounts appear on the register/valuation.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="fixed-assets"`.

### 2.10 DICOM scoping (Phase 6)
**Context:** confirmed a wholly separate PACS-facing domain; **not started** and needs its
own scoping.
**What to do:** write a scoping note (users, workflows, storage — DICOM studies vs. the
radiology module's reports; `@hospital/object-storage` reuse). No implementation until the
human approves scope.
**Verify:** scoping doc in `new/docs/superpowers/specs/`.
**Test:** n/a.

### 2.11 India compliance roadmap (Phase 5 item 13)
**Context:** product-scoping work (DPDP Act, digital records rules, PM-JAY formats,
government disease-reporting mapping), not blocking engineering.
**What to do:** draft a compliance gap checklist in the PRD or a new doc; flag which
existing modules it touches (auth/PII, audit trail, lab reporting).
**Verify:** document exists; no code changes.
**Test:** n/a.

### 2.12 Per-tenant branding (white-label look)
**Context:** the product is sold to hospitals as a SaaS, but every tenant console looks
identical: "Vaidya" (the product brand — teal `#006D77` on `#F0FDFD`, see PRD §1 and
`new/docs/branding/vaidya-*.png`) is **hardcoded** in the frontend:
`apps/staff-console/src/app/shell/shell-chrome.html` (brand mark), `login/login.html`
(3 spots), `change-password/change-password.html`, and `app.config.ts`'s
`VaidyaTealPreset`. Tenant identity (`tenant.hospitalName`) already exists in the tenants
registry and is shown in the platform console's admin-dashboard, but the tenant console
never displays it. Per-tenant branding (hospital display name, logo, primary color) makes
each customer's console feel like their own product.

**Design decisions (agree with the human before building):**
- Branding is **platform-admin-configured** (Super Admin sets it per tenant — consistent
  with the "platform-admin-only changes" ruling on packages; hospital admins don't
  self-edit it) and **tenant-scoped**: hospital A must never read or modify hospital B's
  branding.
- Store it platform-side (public schema, like packages/subscriptions): a `tenant_branding`
  table (tenantId PK, displayName, primaryColor, logoObjectKey) + migration `0052`; or
  columns on `tenants`. Logos go to MinIO via `@hospital/object-storage` under
  `branding/<tenantId>/<filename>` (mirror the Lab/Radiology PDF-mirror pattern).
- Default/fallback = current Vaidya brand when a tenant has no branding configured.
- Login page + tenant console shell both render it (display name, logo, primary color
  applied as CSS variables / dynamic PrimeNG preset); platform console keeps Vaidya.

**What to do:**
- Backend: `TenantBranding` entity + migration `0052`; platform-admin endpoints
  `GET/PUT /platform/tenants/:hospitalId/branding` (+ logo upload) gated by
  `system-admin.tenants.manage`; tenant-facing read (e.g. `GET /tenants/me/branding`
  resolved from the JWT tenant, or bundle branding into the login/refresh response);
  integration spec covering permission gating, cross-tenant isolation, and fallback.
- Frontend: a branding service + store in the tenant console; `shell-chrome`, `login`,
  `change-password` consume it; swap the hardcoded brand mark for displayName/logo and
  drive the primary color through the existing theme setup in `app.config.ts`
  (`--p-*` CSS variable overrides so it works with PrimeNG); platform console unchanged.
- Docs: `Development-Standards.md` §49; PRD §9.4 mention; check off in `pending-tasks.md`.

**Verify:** live — two tenants with different branding show different names/logos/colors
on login + console; unconfigured tenant falls back to Vaidya; demoadmin (non-Super-Admin)
gets 403 on the platform branding endpoints; hospital A cannot fetch B's branding; logo
upload persists in MinIO.
**Test:**
```bash
cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="branding"
cd frontend && CI=true pnpm exec nx run staff-console:test -- --testPathPatterns="shell-chrome|login"
cd frontend && CI=true pnpm exec nx run staff-console:build
```

### 2.13 Fix payroll payslips 500: `month=undefined&year=undefined` query params
**Status:** real live bug, confirmed from the dev-server log (`GET /api/payroll/payslips?page=1&limit=10&month=undefined&year=undefined` → 500 `invalid input syntax for type integer: "undefined"`).

**Context:** `apps/staff-console/src/app/payroll/payroll-list.ts` builds the list query as
`{ page, limit, month: this.monthFilter() ?? undefined, year: this.yearFilter() ?? undefined }`
and passes it as **query params** to `ApiClientService.get`. Angular's `HttpClient` stringifies
`undefined` to the literal string `"undefined"` in the query string. The backend
`ListPayslipsQueryDto` (`new/code/apps/api/src/payroll/dto/payroll.dto.ts`) declares
`month?: number; year?: number`, but there is **no global ValidationPipe/transform** in
`apps/api/src/main.ts`, so the values arrive as raw strings — `query.month !== undefined` is
true (it's the string `"undefined"`) and gets bound to the integer `periodMonth` column → 500.
(The same `?? undefined` pattern in `triage-detail.ts` and `employee-list.ts` is harmless — those
are JSON request bodies, where undefined keys are dropped by serialization. Only query-param
sites break.)

**What to do:** stop sending undefined keys in query params. Cleanest fix: build the params
object conditionally in `payroll-list.ts` (omit `month`/`year` when the filter is null), or add
an `omitUndefined` helper in `ApiClientService.get` that strips undefined values from `params`.
Optionally harden the backend DTO with `@Type(() => Number)`/validation so `"undefined"`
can't reach the query builder — but the frontend fix is the real one.
**Verify:** `GET /api/payroll/payslips?page=1&limit=10` (no month/year) returns 200; the Payroll
screen loads without a 500; filtering by month/year still works.
**Test:**
```bash
cd frontend && CI=true pnpm exec nx run staff-console:test -- --testPathPatterns="payroll"
cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="payroll"
```

---

## 3. Cleanups

### 3.1 Full-suite flake triage (infra, shared dev DB)
**Context:** the full backend suite (~664 tests) occasionally fails random unrelated suites
(observed: `master-data.controller`, `charge-capture`, `patients`, `cssd`, `admissions`,
`seed-rbac`, `metrics`, `master-data-permgate` "ctx undefined") — each passes alone and the
run is green on repeat. Likely parallel-load contention on the shared dev Postgres (all
specs run against the same DB with prefixes + cleanup).
**What to do:** investigate whether a dedicated test database (e.g. `identity_access_test`
with `DB_NAME`/`DB_PORT` env override) or reduced jest `maxWorkers` stabilizes full runs.
Do **not** "fix" a passing-alone spec. If a real bug surfaces during triage, that's a
separate fix task.
**Verify:** 3 consecutive full-suite runs with the same failure set (ideally zero).
**Test:** `cd new/code && CI=true pnpm exec nx run api:test` ×3.

### 3.2 `.claude/` session files keep leaking into commits
**Context:** an auto-committer process swept in-flight work + `.claude/session-context.md`
/ `session-end.md` into a garbled multi-subject commit (`de9cf86`) that was **not**
rewritten (convention: never `--amend`, never rewrite history).
**What to do:** add `.claude/` to the root `.gitignore` (check it isn't already tracked);
commit that as `chore:`. If files are already tracked, `git rm --cached .claude/*` first
(check with the human — they may want the snapshots versioned).
**Verify:** `git status` no longer shows `.claude/` modifications.
**Test:** `git status --short`.

### 3.3 Stale dev-server process
**Context:** background `nx serve api` jobs from earlier sessions were killed; verify only
one current serve job is running and it has the latest code (see 1.4). Leftover servers on
:3000 cause confusing "route not found" reports.
**What to do:** `lsof -i :3000` — if more than one PID listens, kill stale ones and restart
cleanly.
**Verify:** exactly one process on :3000, serving `/platform/billing/subscriptions`.

### 3.4 Frontend repo hygiene
**Context:** the frontend is a separate git repo nested under the root; `git add` from the
root fails with "ignored by .gitignore" for frontend paths — a recurring source of
"didn't commit" confusion.
**What to do:** nothing code-wise — but when committing frontend work, always run git from
inside `frontend/`. Add this reminder to `new/code/CLAUDE.md` if not already there.
**Verify:** n/a.
**Test:** n/a.

---

## 4. Improvements (low-risk, opportunistic)

### 4.1 Seed-demo-data: add a subscription for the demo tenant
**Context:** `nx run api:seed-demo-data` seeds patients/invoice/employees/payslips but the
demo tenant has no subscription — the new Billing panel shows nothing to demo.
**What to do:** in `database/seed-demo-data.ts`, subscribe `demo` (basic, monthly) and
issue one open invoice, idempotent like the rest of the seeder.
**Verify:** `nx run api:seed-demo-data` twice; Billing panel shows a subscription + one
open invoice on the second run without duplicates.
**Test:** `cd new/code && CI=true pnpm exec nx run api:seed-demo-data`.

### 4.2 Notifications shell wiring (do 2.6 first)
**Context:** the shell's notification bell has no data source yet.
**What to do:** after 2.6, wire the bell to `GET /notifications/summary` and route to the
new page.
**Verify:** bell badge reflects unread count; clicking navigates.
**Test:** frontend spec + build.

### 4.3 Self-serve package upgrade path (backend-ready)
**Context:** `PATCH /tenants/:hospitalId/package` + `GET /packages` exist; product chose
platform-admin-only changes, so a tenant-facing self-serve upgrade is **deferred by
decision** — revisit only if the human asks.
**What to do:** nothing now. Note in the PRD that the backend supports it.
**Verify:** n/a.
**Test:** n/a.

---

## 5. Definition of done for every task

1. Typecheck green: `cd new/code && CI=true pnpm exec nx run-many -t typecheck`
   (backend) / `cd frontend && CI=true pnpm exec nx run-many -t typecheck` (frontend).
2. Focused specs green (commands in each task).
3. Live-verified against the running dev API where the task touches behavior — no fake data.
4. One conventional commit per task; backend + frontend committed separately; docs
   (`Development-Standards.md` section + `pending-tasks.md` check-off + `review-comments.md`
   resolve mark) in a separate `docs:` commit.
5. Full backend suite run once at the end; treat a lone flake per 3.1, not as a regression.
