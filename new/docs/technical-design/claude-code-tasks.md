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
**Status (2026-08-22): stale — notifications, vitals, and encounters were already built.**
Checked while picking this item up: `apps/staff-console/src/app/notifications/` (list +
mark-read/mark-all-read, routed at `/notifications`), the shell's notification bell
(`shell-chrome.ts` wired to `GET /notifications/summary`, `markAllAsRead`), `.../vitals/`
(patient-scoped vitals entry, routed at `/clinical/vitals`), and `.../encounters/`
(notes/diagnoses/prescriptions tabs, routed at `/clinical/encounters`) all exist, are routed
with permission guards, and use real API calls (no fake data) — 13/13 tests green, live-verified
against the dev API (notifications list/summary, vitals-by-patient, encounter-notes-by-patient
all 200). Corrected in `pending-tasks.md`'s Phase 6 frontend-pages note too.

**Only remaining piece: patient-portal** — not started, and per the original write-up below, a
bigger product decision needing scope confirmation before any work begins. Not picked up.

**Original context (kept for reference):** tenant console pages built for
Lab/Radiology/Pharmacy/Inventory/Admissions/Orders/Reporting. Patient portal is a bigger product
decision — confirm scope with the human before starting.
**Verify:** routed page renders real data from the API; no fake data; toasts on actions.
**Test:** `cd frontend && CI=true pnpm exec nx run staff-console:test && CI=true pnpm exec nx run staff-console:build`.

### 2.7 Insurance frontend page (Phase 3)
**Status: done (2026-08-22).** See `Development-Standards.md` §50.

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
**Status: done (2026-08-22).** See `india-compliance-roadmap.md`.

**Context:** product-scoping work (DPDP Act, digital records rules, PM-JAY formats,
government disease-reporting mapping), not blocking engineering.
**What to do:** draft a compliance gap checklist in the PRD or a new doc; flag which
existing modules it touches (auth/PII, audit trail, lab reporting).
**Verify:** document exists; no code changes.
**Test:** n/a.

### 2.12 Per-tenant branding (white-label look)
**Status: done (2026-08-22).** Backend commit `102f0d8`, frontend commit `029d3e5`. See
`Development-Standards.md` §51. Live-verified end to end (upsert → public read reflects it →
logo upload/retrieve/remove → reset to default → 403 without permission → 400 on unsupported
mime type → 413 on oversized upload, not a raw 500 → concurrent first-time writes both succeed
instead of one hitting a raw primary-key violation). Full backend (95 relevant) and frontend
(311) suites green; production build succeeds. Passed a high-effort `/code-review` (8 angles) —
4 real findings fixed inline (missing advisory lock, missing multer size limit, a second
disconnected route-exclusion list, two duplicated code blocks); 3 more routed to new backlog
items below rather than expanding this task's diff (a tenant-status check on
billing/branding-admin actions, a `changeInitialPassword` auth-boundary gap, and consolidating
3 independent tenant-validation-guard implementations).

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
**Status: done (2026-08-22), frontend commit `21083b8`.** Fixed at the frontend layer per the
"Cleanest fix" option below — `PayrollApiService.listPayslips` now builds the query object
conditionally (matching every other `*-api.service.ts` in the app) instead of spreading a
possibly-undefined filters object into `{ params }`. 2 new HTTP-level regression tests
(`payroll-api.service.spec.ts`) assert the literal `"undefined"` string never reaches the query
string. Live-verified against the dev API: the old buggy shape
(`?month=undefined&year=undefined`) still 500s (confirms root cause), the fixed shape
(`?page=1&limit=10`, no month/year keys) 200s, and filtering by month/year still works.
Convention recorded in `frontend/CLAUDE.md`'s screen-building-conventions section.

**Backend hardening NOT done — correcting the note below:** the "optionally harden the backend
DTO with `@Type(() => Number)`" suggestion turns out not to work as stated. Checked: **no
`ValidationPipe` is registered anywhere in this app** (global or per-route — grepped
`apps/api/src/main.ts` and the whole `apps/api/src` tree). Several *other* DTOs already carry
`@IsOptional() @Type(() => Number) @IsInt()` decorators (`notifications/dto/search-notifications.dto.ts`,
`audit/dto/search-audit-records.dto.ts`, and others) that are **entirely inert** — NestJS only
invokes class-validator/class-transformer through an active `ValidationPipe`, so these decorators
currently do nothing at runtime. Adding the same decorators to `ListPayslipsQueryDto` would have
been equally inert without first wiring a pipe. That's a real, separate, codebase-wide finding —
see the new backlog item below rather than a quick add here; wiring a global `ValidationPipe` has
a much bigger blast radius (every controller in the app) than this one bug's scope justified.

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

### 2.14 No `ValidationPipe` registered anywhere — `class-validator` decorators on ~9 DTOs are dead code
**Status: Phase A done** (commits `e2e5e66` spec, `ecf3dcc` implementation). Split into two phases
during design — see `new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md`: a
re-audit found only 9 of 104 DTOs carry any `class-validator` decorator, and `whitelist: true`
strips any field with zero decorators, so enabling it now would have silently emptied the other 95
DTOs' request bodies. Phase A (done) wires a global `ValidationPipe` with `whitelist`/
`forbidNonWhitelisted` off — activates the 9 already-decorated DTOs, coerces typed-but-undecorated
numeric/boolean fields via `enableImplicitConversion`, changes zero behavior elsewhere. Phase B
(the actual "every controller validated, whitelist on" hardening) is deferred — see 2.18 below.
**Context (found while fixing 2.13):** grepped `apps/api/src/main.ts` and the whole `apps/api/src`
tree for `ValidationPipe`/`APP_PIPE` — neither appears anywhere, global or per-route. NestJS only
invokes `class-validator`/`class-transformer` (`@IsOptional()`, `@IsInt()`, `@Type(() => Number)`,
`@IsEnum()`, etc.) through an active `ValidationPipe`. Without one, `@Body()`/`@Query()` DTOs are
plain objects with zero runtime validation or type coercion — the decorators compile and typecheck
fine but do nothing at request time. Confirmed affected: `notifications/dto/search-notifications.dto.ts`,
`audit/dto/search-audit-records.dto.ts`, `pharmacy/dto/list-pharmacy-dispensing.dto.ts`,
`lab/dto/update-price.dto.ts`, `radiology/dto/update-price.dto.ts`,
`radiology/dto/list-radiology-requisition.dto.ts`, `inventory/dto/update-price.dto.ts`,
`billing/dto/list-invoices.dto.ts`, `billing/dto/list-deposits.dto.ts` (grep for `@Type(` under
`apps/api/src --include="*.dto.ts"` to re-find the current list — more may have been added since).
2.13's payroll bug is one concrete symptom of this gap (an unvalidated string reaching a query
builder as if it were the declared type), but it's a general soundness gap: any endpoint relying on
these decorators for input shape currently has none of the protection its code implies.

**What to do:** wire a global `ValidationPipe` (`app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, ... }))` in `main.ts`, or `APP_PIPE` in `app.module.ts`). This is a
**bigger, riskier change than it looks** — every controller in the app gets validated for the
first time, and `whitelist: true` (stripping/rejecting unexpected body/query properties) could
break any endpoint whose DTO is currently incomplete relative to what the frontend actually sends.
Needs a careful pass: audit every existing DTO for accuracy against its real payload shape before
flipping the switch, not just add the pipe and see what breaks in prod. Given the blast radius,
this likely wants the heavyweight brainstorm→plan pipeline (`CLAUDE.md`'s "The Heavyweight
Pipeline"), not a fast-track fix, despite looking like a one-line change.
**Verify:** full backend suite green with the pipe active; every existing DTO's decorators
actually match its real request shape (audit pass); a request with a malformed/wrong-typed field
now 400s instead of reaching a query builder or entity save.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test` (full suite, not just payroll —
this change is app-wide by nature).

---

### 2.15 Archived/suspended tenants can still be billed and re-branded via platform-admin routes

**Context:** Found during the 2.12 (per-tenant branding) code review. Neither
`SubscriptionBillingService`'s `tenantRow` lookup nor `PlatformBrandingService`'s
`assertBrandableTenant` (both in `new/code/apps/api/src/platform-billing/` and
`.../platform-branding/` respectively) check the tenant's `status` column — they only confirm the
row exists and isn't the platform tenant. A platform admin can create/adjust a subscription or
upload branding for a tenant that's already `archived`/`suspended`.
**What to do:** Decide the intended behavior first (block entirely vs. allow with a warning — an
archived tenant may legitimately need billing cleanup after the fact) before writing a guard.
Likely a shared status check reused by both services (see 2.17 below — this may fold into that
consolidation rather than being fixed twice).
**Verify:** an admin request against an archived/suspended tenant either 409s with a clear message
or is explicitly allowed with a documented reason — not silently permitted by omission.
**Test:** extend the existing `subscription-billing.integration-spec.ts` and
`platform-branding.integration-spec.ts` with an archived-tenant case each.

---

### 2.16 `AuthService.changeInitialPassword` bypasses the tenant-status gate that `login`/`refresh` already enforce

**Context:** Found during the 2.12 code review. `login` and `refresh` (in
`new/code/apps/api/src/auth/auth.service.ts`) both check tenant status before issuing tokens;
`changeInitialPassword` — the must-change-password onboarding flow, excluded from
`AuthContextMiddleware` the same way `login` is (see `app.module.ts`) — does not, so a suspended or
archived tenant's onboarding account could still complete its first password change.
**What to do:** Add the same tenant-status check `login` uses to `changeInitialPassword`, before it
issues any token.
**Verify:** a `changeInitialPassword` call for an account under a suspended/archived tenant is
rejected the same way `login` would reject it.
**Test:** extend the existing auth integration spec covering `changeInitialPassword` with a
suspended-tenant case, mirroring the existing `login` suspended-tenant test.

---

### 2.17 Three independent "assert real, non-platform tenant" guards should consolidate

**Context:** Found during the 2.12 code review. `TenantsService.loadMutableTenant`,
`SubscriptionBillingService`'s `tenantRow`, and `PlatformBrandingService.assertBrandableTenant` each
reimplement "look up the tenant row, reject the platform tenant, reject if not found" independently
— same shape, three copies, already drifting slightly (see 2.15: only some check status).
**What to do:** Extract one shared method (likely on `TenantsService`, injected into the other two)
that the other two call instead of reimplementing. Natural to do alongside 2.15 once that decides
what status check belongs in the shared version.
**Verify:** all three call sites use the same guard; existing tests for each still pass unchanged
(behavior-preserving refactor, not a scope change on its own — 2.15 is where behavior changes).
**Test:** run the existing `tenants`, `platform-billing`, and `platform-branding` integration specs
after the refactor; no new test cases needed unless 2.15 is folded in at the same time.

---

### 2.18 Audit and decorate the remaining ~95 DTOs, then enable `whitelist`/`forbidNonWhitelisted` (2.14 Phase B)

**Status: done.** All 104 DTOs decorated (76 via 4 parallel agents, 19 security/money-sensitive
DTOs by hand, 9 already done in Phase A); `whitelist: true` flipped in
`apps/api/src/app/api-validation-pipe.ts` (`forbidNonWhitelisted` stays off — see §53 in
`Development-Standards.md`). Full backend suite green (696/697, 1 pre-existing skip). A `/code-review
high` pass surfaced several real findings fixed inline (integer-column fields that were `@IsNumber()`
instead of `@IsInt()`, two hand-rolled pagination DTOs that should've extended `PaginationQueryDto`,
a missing non-negative-price guard, an empty-string password bypass, an unbounded branding
display-name field, an SVG-logo stored-XSS vector, and a `/branding` path-suffix collision
suppressing a security-monitoring warning) — see §53 for the full list. Findings on **other,
already-shipped features** surfaced by the same review are logged as 2.19–2.21 below rather than
fixed here, to keep this task's diff scoped to DTO validation.

**Context:** 2.14 Phase A (done — see that section above and
`new/docs/superpowers/specs/2026-08-22-global-validation-pipe-design.md`) wired a global
`ValidationPipe` but deliberately left `whitelist`/`forbidNonWhitelisted` off, because only 9 of 104
DTOs under `apps/api/src` carry any `class-validator` decorator — `whitelist: true` strips any field
with zero decorators, so turning it on today would silently empty the other 95 DTOs' request bodies
(`PaginationQueryDto` included). This is the actual "every controller gets validated for real,
unexpected fields get rejected" hardening the original 2.14 write-up described, deferred out of
Phase A because of its size and risk.
**What to do:** per-module pass auditing each undecorated DTO against its real request payload
(frontend call sites + Swagger), adding the validators its fields warrant, then flipping
`whitelist: true` (and evaluating `forbidNonWhitelisted: true`) once the audit is complete —
globally in `apps/api/src/app/api-validation-pipe.ts`, or per-module if a staged rollout is safer.
Given the size (95 DTOs across every module), this likely wants its own heavyweight
brainstorm→plan pass to decide sequencing (all-at-once vs. per-module) rather than one sitting.
**Verify:** full backend suite green with `whitelist: true` active; every DTO's decorators match its
real request shape; an unexpected/extra field on a request now 400s (if `forbidNonWhitelisted` is
also enabled) or is silently stripped (if not) instead of reaching a query builder or entity save.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test` (full suite — this change is app-wide).

---

### 2.19 `markInvoicePaid` can silently resurrect a concurrently-canceled subscription (done)

**Context:** Found during 2.18's code review, in already-shipped platform-billing code (not
touched by 2.18 itself). `SubscriptionBillingService.markInvoicePaid`
(`new/code/apps/api/src/platform-billing/subscription-billing.service.ts:171-209`) takes only the
invoice-scoped advisory lock (`platform_billing_invoice:${invoiceId}`), not the tenant-scoped lock
(`platform_billing:${tenantId}`) that `subscribe`/`cancelSubscription`/`issueInvoice` use — the
comment there asserts mark-paid "never contends" with tenant-locked operations, but it reads the
full `Subscription` entity into memory, then unconditionally `.save()`s it (line 205), which
TypeORM writes every column of, not just the changed ones.
**Failure scenario:** Thread A starts `markInvoicePaid` and reads a subscription (`status:
'active'`) before Thread B's `cancelSubscription` (holding the tenant lock) commits `status:
'canceled'`. Thread A then saves its stale in-memory object, overwriting the cancellation and
reactivating billing for a tenant that just canceled.
**What to do:** have `markInvoicePaid` also acquire the tenant-scoped advisory lock (or re-read the
subscription's current status inside the same locked transaction before deciding what to persist,
and only write the fields that actually changed rather than the whole entity).
**Verify:** a concurrent cancel + mark-paid pair against the same tenant never results in a
`canceled` subscription reverting to `active`.
**Test:** extend `subscription-billing.service.integration-spec.ts` with a `Promise.allSettled`
race test mirroring the existing concurrent-upsert pattern in `platform-branding.integration-spec.ts`.

**Done (2026-08-23):** `markInvoicePaid` now also takes the tenant-scoped `platform_billing:${tenantId}`
lock (after the invoice lock, before touching the subscription) and re-reads the subscription only
after acquiring it. New `2.19:` race test verified to fail 4/5 runs against the pre-fix code and
pass 5/5 against the fix, before committing. Full detail: `Development-Standards.md` §57.

---

### 2.20 Tenant purge: non-atomic delete ordering (cross-tenant PHI leak risk) + cascades away platform revenue records (done)

**Context:** Found during 2.18's code review, in already-shipped tenant-lifecycle code (§47, not
touched by 2.18). Two related issues in `TenantsService.purgeTenant`
(`new/code/apps/api/src/tenants/tenants.service.ts:535` area):
1. **Non-atomic, wrong-order deletes.** `remove(tenant)` (deletes the `tenants` registry row) runs
   *before* `DROP SCHEMA .../DROP ROLE`, outside a transaction. If the schema drop fails or hangs
   (e.g. a lock held by an in-flight query), the registry row is already gone — `hospitalId` is
   immediately reusable, and `provisionTenant`'s `CREATE SCHEMA IF NOT EXISTS` silently succeeds
   against the still-populated old schema, exposing the previous tenant's full PHI/financial data
   to the new tenant's admin.
2. **Cascade deletes platform revenue records.** `subscriptions`/`subscription_invoices`
   (migration `0051`) both `REFERENCES tenants("hospitalId") ON DELETE CASCADE`, so purging a
   tenant permanently deletes the platform's own billing/revenue history for that tenant —
   unlike `tenant___platform.audit_records`, which the purge docstring explicitly says survives.
**What to do:** wrap the drop-schema/drop-role/remove-registry-row sequence in a transaction with
schema+role dropped *before* the registry row (so a failure leaves the row intact, blocking
hospitalId reuse, rather than freeing it); decide whether `subscription_invoices`/`subscriptions`
should be preserved (change the FK to `ON DELETE SET NULL` or archive them) instead of cascading.
**Verify:** a purge that fails partway through the schema drop leaves the registry row in place; a
successful purge either preserves or intentionally archives the tenant's billing history.
**Test:** extend the existing purge integration spec with a schema-drop-failure simulation and a
post-purge check of `subscription_invoices`.

**Done (2026-08-22/23):** `purgeTenant` now wraps `DROP SCHEMA`/`DROP ROLE`/registry-row `remove()`
in one `dataSource.transaction`, DDL drops before the registry-row removal — a mid-purge failure
rolls back atomically and leaves the row in place, blocking `hospitalId` reuse. Migration
`0055-drop-subscriptions-tenant-fk-cascade.ts` drops `subscriptions.tenantId`'s `ON DELETE CASCADE`
FK (matching the existing `audit_records`-has-no-FK precedent), so billing/revenue history now
survives a purge. New tests in `tenants.service.integration-spec.ts`: rejects a non-archived purge,
a happy-path purge that preserves a subscription row, and a forced real `DROP ROLE` failure
(role owns a dummy table outside its schema) proving the transaction actually rolls back and the
registry row survives. Full detail: `Development-Standards.md` §55. Surfaced one new follow-on gap,
logged as 2.28 below rather than fixed in this pass.

---

### 2.21 Lower-priority platform-billing gaps: no runtime `billingCycle` guard, unscoped `listInvoices` (done)

**Context:** Found during 2.18's code review, in already-shipped platform-billing code.
- `SubscriptionBillingService.subscribe`/`resolvePrice` (`subscription-billing.service.ts:39,105`)
  trust the TypeScript `BillingCycle` type with no runtime check — only the DTO's `@IsIn(...)`
  enforces valid values. A caller reaching the service directly (a future cron/auto-renew job)
  with an invalid value hits `CYCLE_MS[billingCycle]` → `undefined` → `Invalid Date`, silently
  persisted; `resolvePrice` compounds this by silently falling back to monthly pricing instead of
  rejecting.
- `listInvoices(tenantId?: string)` (`subscription-billing.service.ts:211`) returns *all* tenants'
  invoices when called without an argument. Not currently exploitable (the only caller always
  passes `hospitalId`), but a live cross-tenant billing-data-exposure footgun for any future caller.
**What to do:** add a runtime guard in `subscribe`/`resolvePrice` that throws on an unrecognized
`billingCycle` instead of silently defaulting; make `tenantId` required on `listInvoices` (or split
into `listInvoicesForTenant`/an explicitly-named cross-tenant admin variant).
**Verify:** an invalid `billingCycle` reaching the service throws instead of persisting a corrupted
row; no code path can call `listInvoices` without an explicit tenant scope.
**Test:** extend `subscription-billing.service.integration-spec.ts`.

**Done (2026-08-23):** `resolvePrice` now throws `BadRequestException` on an unrecognized
`billingCycle` instead of silently pricing as monthly; `listInvoices(tenantId: string)` no longer
accepts an omitted tenant. New tests in `subscription-billing.service.integration-spec.ts`.

---

### 2.22 Billing-cycle switch doesn't adjust the billing period — recurring 10x overcharge/undercharge (done)

**Context:** found during the entity-audit-columns task's code review, in already-shipped
platform-billing code. `SubscriptionBillingService.subscribe()`
(`new/code/apps/api/src/platform-billing/subscription-billing.service.ts:100-111`) reuses the
existing active subscription row when switching billing cycles, updating `packageCode`/
`billingCycle`/`pricePerCycle`/`status` but leaving `currentPeriodStart`/`currentPeriodEnd`
untouched.
**Failure scenario:** tenant subscribes monthly (₹4,999, a 30-day period). On day 5, an admin
switches them to annual — `pricePerCycle` becomes ₹54,000 but the period stays the original 30-day
window. `issueInvoice()` bills the full annual price for a 30-day period, and `markInvoicePaid()`
advances the next period by that same 30-day length — the tenant is charged the full annual price
every 30 days indefinitely. The reverse switch (annual→monthly) undercharges the platform by the
same mechanism. The existing test only asserts the new price, never period bounds after a switch.
**What to do:** when `billingCycle` changes on an active subscription, recompute
`currentPeriodStart`/`currentPeriodEnd` to match the new cycle length (or require canceling and
re-subscribing instead of an in-place cycle switch — a design decision, not just a bug fix).
**Verify:** switching cycles produces a period length matching the new `billingCycle`; the next
invoice bills the correct amount for that period.
**Test:** extend `subscription-billing.service.integration-spec.ts` with a monthly→annual and an
annual→monthly switch, asserting period bounds and the next invoice amount.

**Done (2026-08-23):** `subscribe()` now only resets `currentPeriodStart`/`currentPeriodEnd` when
`billingCycle` actually differs from the existing active row's — a same-cycle re-subscribe still
keeps its current period untouched. New tests cover both the cycle-switch (period resets, sized to
the new cycle) and same-cycle (period preserved) paths.

---

### 2.23 Tenant provisioning is non-transactional; a purged tenant + stale refresh token 500s instead of 401

**Context:** found during the entity-audit-columns task's code review, in already-shipped
tenant/auth code.
1. **`TenantsService.provisionTenant()`** (`tenants.service.ts:112`) commits the `tenants` registry
   row as `status: 'active'` before department seeding and bootstrap-admin creation run, with no
   transaction/rollback around any of it. A failure partway through (e.g. a duplicate
   `departmentCode` in `departmentCatalogIds`) leaves a tenant that looks provisioned in every
   listing but has zero login-capable accounts — and retrying `POST /tenants` with the same
   `hospitalId` now 409s, so the only recovery is archive+purge and starting over.
2. **`AuthService.refresh()`** (`auth.service.ts:173`) keys its suspended/archived gate off
   `tenantsService.getTenant(hospitalId)`, which returns `null` once a tenant is purged. A `null`
   tenant fails the `=== suspended || === archived` check, so the gate doesn't fire — a still-valid
   refresh token issued before the purge proceeds into `accountsService` calls against a schema that
   no longer exists, surfacing as a raw 500 instead of the intended 401.
**What to do:** wrap `provisionTenant`'s registry-insert + department-seed + bootstrap-admin steps
in a transaction (or add a cleanup path that can retry/complete a partially-provisioned tenant
without requiring purge); add an explicit "tenant not found" check to `refresh()`'s gate (treat
`null` the same as `archived`, not as "no gate needed").
**Verify:** a provisioning failure partway through leaves no orphaned active tenant (either fully
rolled back or clearly flagged incomplete and recoverable); refresh with a token for a purged
tenant returns 401, not 500.
**Test:** extend `tenants.service.integration-spec.ts` with a provisioning-failure case; extend
`auth.service.integration-spec.ts`/`auth.controller.integration-spec.ts` with a purge-then-refresh
case (only suspend/archive are currently tested).

---

### 2.24 Test-coverage gaps surfaced by code review (validation pipe, platform-billing, platform-branding)

**Context:** found during the entity-audit-columns task's code review, across already-shipped code
from earlier tasks. None of these are live bugs today — they're missing regression coverage that
would let a *future* change ship silently broken.
- **~13 pre-existing HTTP integration specs boot the real `AppModule` but never register the global
  `ValidationPipe`** (`admissions/admissions.controller.integration-spec.ts`,
  `app/metrics.integration-spec.ts`, `app/mvp-workflow.integration-spec.ts`,
  `appointments/appointments.controller.integration-spec.ts`, `auth/auth.controller.integration-spec.ts`,
  `auth/cross-tenant-login.integration-spec.ts`, `billing/billing-settings.controller.integration-spec.ts`,
  `billing/deposits.controller.integration-spec.ts`, `billing/invoices.controller.integration-spec.ts`,
  `clinical/encounters/encounters.controller.integration-spec.ts`,
  `clinical/triage/triage.controller.integration-spec.ts`,
  `clinical/vitals/vitals.controller.integration-spec.ts`, `orders/orders.controller.integration-spec.ts`)
  — a future validator regression on any DTO these cover would ship green.
- **`platform-billing-permission-gating.integration-spec.ts`** only asserts 403-without-permission
  for 4 of 6 controller routes (`POST .../cancel`, `GET .../invoices` list, and
  `POST /invoices/:invoiceId/paid` are untested).
- **`platform-branding.integration-spec.ts`** has no HTTP-level test of the public,
  pre-auth `GET /branding` route at all (every test calls the service directly, bypassing
  middleware/routing entirely), and its permission-gating loop omits `POST .../logo` (upload).
**What to do:** add `app.useGlobalPipes(createApiValidationPipe())` to the ~13 specs (or establish a
shared test-app-factory helper that always registers it, closing this class of gap for future specs
too); add the 3 missing routes to platform-billing's permission-gating loop; add an HTTP-level test
for `GET /branding` and the missing `POST .../logo` permission-gating case.
**Verify:** each spec fails if the protection it's supposed to cover is removed (verify by
temporarily removing a decorator/pipe registration locally and confirming the test catches it, then
restoring it).
**Test:** the specs themselves, once extended.

---

### 2.25 Minor DTO-decorator gaps from the earlier ValidationPipe Phase B pass

**Context:** found during the entity-audit-columns task's code review, in already-shipped DTO
decoration code (2.14/2.18). Low severity, no security impact.
- `maternity.dto.ts`'s `lmp`/`edd`/`deliveryDate` are `@IsString()` but map to Postgres `date`
  columns and are compared with string ordering (`lmp > edd`) in `maternity.service.ts` — should be
  `@IsDateString()` like the equivalent fields elsewhere in the same pass (`nursing.dto.ts`'s
  `dueAt`, `ot.dto.ts`'s `scheduledAt`).
- `inventory/dto/create-inventory-item-category.dto.ts`'s `displaySequence` is `@IsNumber()` but the
  column is Postgres `int` — should be `@IsInt()` (a decimal value passes validation, then 500s at
  the DB insert instead of a clean 400).
- `insurance.dto.ts`'s `ListClaimsQueryDto.status` hardcodes its `@IsIn([...])` list instead of
  reusing the exported `INSURANCE_CLAIM_STATUSES` constant (the sibling `fixed-asset.dto.ts` in the
  same pass correctly reuses `FIXED_ASSET_CONDITIONS`) — a future new status value would need
  updating in two places, and missing one silently 400s valid requests.
**What to do:** fix the three decorators/reuse as described.
**Verify:** `POST /maternity-records` with a malformed date 400s instead of reaching the DB;
`POST /inventory/item-categories` with a decimal `displaySequence` 400s; `insurance.dto.ts` imports
`INSURANCE_CLAIM_STATUSES` instead of duplicating the list.
**Test:** one-line additions to each module's existing DTO/controller integration specs.

---

### 2.26 Reporting PDF export can block the event loop; CSV/PDF row-mapping is duplicated

**Status: done.** PDF row limit is now 500, and row-mapping logic is deduplicated across CSV and PDF exports.

**Context:** found during the entity-audit-columns task's code review, in already-shipped reporting
code (`reporting-query.service.ts`).
- `exportEventsPdf` (line ~142) loads up to 10,000 rows and hands them to `pdfmake`, which lays out
  and renders the whole landscape table **synchronously** on the Node event loop (confirmed in
  `pdfmake`'s own source — no chunking, no worker-thread offload, same row cap as the much-cheaper
  CSV export). A broad-date-range export from any tenant with `reporting.read` can stall every other
  concurrent request on that API process for the duration — a single-tenant DoS of a shared process.
- `exportEventsCsv` and `exportEventsPdf` duplicate the identical row-shaping `.map(...)` verbatim
  instead of sharing a helper — a future field-serialization fix applied to one silently doesn't
  apply to the other.
**What to do:** lower the PDF row cap well below the CSV cap, and/or offload PDF generation to a
worker thread / queue it as a background job instead of generating synchronously inside the request
handler; extract the shared row-mapping into one function both exports call.
**Verify:** a large PDF export no longer blocks concurrent requests from other tenants during
generation; CSV and PDF exports of the same data can't drift in field formatting.
**Test:** a load-adjacent test asserting a concurrent request completes promptly during a large PDF
export (or a documented manual verification if that's impractical in the test harness).

---

### 2.27 Standard audit columns across entities (done)

**Status: done.** Not a pre-existing backlog item — user-requested mid-session. Added
`createdAt`/`createdBy`/`updatedAt`/`updatedBy` (base `AuditableEntity`) and `deletedAt`/`deletedBy`
(soft-delete tier `SoftDeletableEntity extends AuditableEntity`) to 61 entities (54 tenant-scoped +
7 platform-scoped) representing business/clinical/financial records and actively-managed
lookup/catalog tables — see
`new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md` for the full design,
scoping rule, and 10 numbered implementation lessons (two-tier class split, `varchar` not `uuid`
for actor columns, verifying against real migrations not the entity class, `PLATFORM_MIGRATIONS`
needing an explicit `nx run api:migrate`, and — the most consequential one — why
`AuditColumnsSubscriber` needs `afterSoftRemove` with an explicit follow-up `UPDATE`, not
`beforeSoftRemove` mutating the entity, because TypeORM's `softRemove()` never reads other entity
properties for its SQL). Converted the 3 genuine hard-delete call sites found
(`Prescription`/`Diagnosis`/`Vital`) to `softRemove()`. A `/code-review high` pass on the diff (this
touches PHI, money, and auth entities across nearly the whole app) found and fixed two real bugs
before commit — a subscriber-bypassing raw `manager.update()` in `Patient.deactivate()`, and 3
pre-existing `uuid`-typed `createdBy` columns (`invoices`, `journal_entries`, `nursing_tasks`) that
the migration's `ADD COLUMN IF NOT EXISTS` silently no-op'd past instead of converting — and
surfaced several findings on unrelated, already-shipped code, logged separately as 2.22–2.26.
**Verify:** all 61 entities compile with `noImplicitOverride` (catches any missed duplicate
`createdAt`/`updatedAt` declaration); full backend suite green; a dedicated
`audit-columns.integration-spec.ts` proves the subscriber populates all 3 actor columns end-to-end
through the real `AppModule`, including the soft-delete path.
**Test:** `cd new/code && CI=true pnpm exec nx run api:test` (full suite — app-wide schema change).

---

### 2.28 A purged tenant's `hospitalId` is freely reusable, and a new tenant inherits the old tenant's billing history

**Context:** Found while fixing 2.20. `TenantsService.provisionTenant`
(`apps/api/src/tenants/tenants.service.ts:96-100`) only checks the live `tenants` table for a
`hospitalId` collision — purge deletes that row, so nothing stops a brand-new, unrelated tenant
from being provisioned with a previously-purged `hospitalId`. Combined with 2.20's fix (dropping
`subscriptions.tenantId`'s FK so billing history survives purge, migration 0055), a reused
`hospitalId` would show the *previous* tenant's `subscriptions`/`subscription_invoices` rows mixed
into the new tenant's billing views — `SubscriptionBillingService.getSubscription`/
`listSubscriptions` filter only by the `tenantId` string, with no way to distinguish "this tenant's
history" from "a different, purged tenant that once had the same id."
**What to do:** decide the retirement policy for a purged `hospitalId` — either block reuse
outright (check for orphaned `subscriptions` rows in `provisionTenant`, or keep a permanent
tombstone table of purged ids), or tag `subscriptions`/`subscription_invoices` rows with a
purge-timestamp/generation marker so a reused id's billing views can filter to the current tenant's
lineage only. Related to 2.23 (purge + stale refresh token 500s) — both stem from "purge frees
`hospitalId` for reuse" being under-specified; worth tackling together.
**Verify:** provisioning a tenant with a `hospitalId` that has orphaned `subscriptions` rows from a
prior purged tenant either fails with a clear error, or the new tenant's billing views correctly
exclude the prior tenant's history.
**Test:** extend `tenants.service.integration-spec.ts`'s purge tests with a purge-then-reprovision
case asserting the chosen behavior.

---

### 2.29 More DTO-decorator gaps: `@IsNumber()` where the column needs an integer, one missing `@Min(0)`

**Status: done (already fixed in previous commit `82cbf2b`).**

**Context:** found during `/code-review high` on 2.21/2.22, in already-shipped DTO code (same class
of bug as 2.25, different files).
- `@IsNumber()` should be `@IsInt()` (decimal passes validation, then either corrupts a business
  value or 500s at the DB insert instead of a clean 400): `triage/dto/create-triage-entry.dto.ts:42`
  + `update-triage-entry.dto.ts` (`acuityLevel`, sorts the live ED triage queue);
  `encounters/dto/encounter.dto.ts:99-100` (`CreatePrescriptionDto.durationDays`);
  `cssd/dto/cssd.dto.ts:18,32` (`quantity` on Create/UpdateInstrumentDto, sterile-instrument
  inventory counts); `ot/dto/ot.dto.ts:38-46` (`ListSurgeriesQueryDto.page`/`limit`, doesn't extend
  the shared `PaginationQueryDto` the way every sibling list DTO does);
  `marketing/dto/marketing.dto.ts:44-52` (`ListReferralsQueryDto.page`/`limit`, same gap).
- `radiology/dto/create-radiology-imaging-item.dto.ts:18-20` — `price?: number` has no `@Min(0)`,
  unlike `RadiologyCatalogService.update`/`updateItemPrice`, which explicitly reject a negative
  price; creation has no equivalent guard, so `POST /radiology/imaging-items` accepts a negative
  price at creation time.
**What to do:** switch the five `@IsNumber()` fields to `@IsInt()` (with an appropriate `@Min`); add
`@Min(0)` to the radiology item price; have `ot.dto.ts`/`marketing.dto.ts`'s list DTOs extend
`PaginationQueryDto` instead of hand-rolling `page`/`limit`.
**Verify:** each endpoint 400s on a decimal/negative value that previously passed validation.
**Test:** one-line additions to each module's existing DTO/controller integration specs, matching
2.25's pattern.

---

### 2.30 Tenant-provisioning `adminPassword` empty string bypasses the generated-password fallback

**Status: done (already fixed in previous commit `82cbf2b` via `@IsNotEmpty`).**

**Context:** found during `/code-review high` on 2.21/2.22, in already-shipped tenant-provisioning
code. `tenants/dto/provision-tenant.dto.ts:25-27`'s `adminPassword?: string` has only
`@IsOptional() @IsString()`, no length/non-empty guard. `TenantsService.createBootstrapAdmin` does
`provided.password ?? generateBootstrapPassword()`, and `AccountsService.createStaffAccount` does
`input.password ? undefined : generateInitialPassword()` then `input.password ?? generatedPassword`
— both `??`/truthy checks only catch `null`/`undefined`, not `''`. `POST /tenants/provision` with
`"adminPassword": ""` slips past both fallbacks and creates the bootstrap Hospital Admin account
with an effectively empty (bcrypt-hashed empty string) password, bypassing the intended
generate-a-strong-password-when-none-supplied path.
**What to do:** add `@MinLength(n)` (or an explicit non-empty check) to `adminPassword` in
`provision-tenant.dto.ts`, matching whatever minimum the generated passwords already satisfy.
**Verify:** `POST /tenants/provision` with `adminPassword: ""` 400s instead of provisioning an
account with an empty password.
**Test:** one-line addition to `tenants.controller.integration-spec.ts`.

---

### 2.31 Platform branding: unbounded `displayName`, SVG logo accepted as an unsniffed content-type (stored-XSS risk)

**Status: done (already fixed in previous commit `82cbf2b` via `@MaxLength(200)` and blocking SVG).**

**Context:** found during `/code-review high` on 2.21/2.22, in already-shipped platform-branding
code (§51).
- `platform-branding/dto/upsert-branding.dto.ts:8` — `displayName` has no `@MaxLength`; unbounded
  storage/echo risk.
- `platform-branding.service.ts:13-18,159-161` — SVG is accepted as a logo mime type, trusting the
  client-supplied content-type with no server-side sniffing/sanitization. An SVG can carry inline
  `<script>`/event-handler payloads; served back via the presigned logo URL, this is a stored-XSS
  vector against whoever views the tenant's branding (admin UI, and potentially the tenant's own
  login page if branding renders there).
**What to do:** add `@MaxLength` to `displayName`; either strip SVG from the accepted logo mime
list, or sanitize uploaded SVGs server-side (e.g. strip `<script>`/`on*` attributes) before storing.
**Verify:** an overlong `displayName` 400s; an SVG upload containing a `<script>` tag is rejected or
sanitized, not stored/served as-is.
**Test:** extend `platform-branding.integration-spec.ts` with an oversized-name case and a
malicious-SVG upload case.

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

**Status: done.** `.claude/` is in root `.gitignore` and cached session files untracked.

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

### 3.5 Reuse cleanups surfaced by 2.18's code review (advisory-lock pattern, auth.service.ts duplication)
**Context:** found in already-shipped code, not urgent enough for its own numbered item:
- `pg_advisory_xact_lock(hashtext($1))` per-tenant/per-row locking is hand-copied 4 times
  (`subscription-billing.service.ts` ×2, `platform-branding.service.ts`, pre-existing
  `invoices.service.ts:261`), each with its own explanatory comment. A shared `withAdvisoryLock(manager,
  key)` helper would collapse these to one line each.
- `auth.service.ts`'s `tenant?.status === 'suspended' || tenant?.status === 'archived'` check is
  written out twice (`login()` line 85, `refresh()` line 174) — extract a private
  `isTenantInactive(tenant)` helper so a future third status can't be added to one copy and
  forgotten on the other.
- `SubscriptionBillingService.tenantRow()` (`subscription-billing.service.ts:45`) returns a
  single-field `{ packageCode }` wrapper immediately destructured by its only caller — inline as
  `resolvePackageCode(): Promise<string>`.
- A per-file `assertNotPlatformTenant`-shaped guard (reject `__platform` before billing/branding
  ops) is repeated 7+ times across 4 files with bespoke messages each — lower-confidence candidate
  for consolidation, since each throw message is intentionally specific to its call site.
**What to do:** low-priority — fold into whatever task next touches these files, not worth a
standalone session.
**Verify:** n/a.
**Test:** n/a.

### 3.6 No structural enforcement that every DTO field carries a class-validator decorator
**Context:** 2.18 hand-decorated all 104 DTOs so `whitelist: true` is safe today, but nothing
stops a future field added to any of them from shipping without a decorator — it would be
silently stripped by the pipe in production with no test failure, no lint error, no 400.
TypeScript property declarations have no runtime footprint to reflect on (only assigned or
decorated properties do), so this needs either a custom ESLint rule or a small AST-based static
check (e.g. via the TypeScript compiler API or `ts-morph`) run in CI/tests, not a simple
reflection-based unit test — a non-trivial enough lift that it didn't fit inside 2.18 itself.
**What to do:** write a static check (lint rule or a dedicated Jest test using `ts-morph` to parse
every `*.dto.ts` file's class properties and cross-reference against
`class-validator`'s `getMetadataStorage()`) that fails when a DTO field has zero validators.
**Verify:** the check fails on a deliberately-undecorated test fixture field; passes on the
current tree.
**Test:** n/a until written.

### 3.7 Two independently-maintained "no-auth-context-expected" route lists could drift

**Status: done.** Consolidated into `UNAUTHENTICATED_ROUTES` exported by `@hospital/tenant-context` and consumed by both `TenantContextMiddleware` and `AppModule`.

**Context:** found during the entity-audit-columns task's code review. `app.module.ts`'s
`AuthContextMiddleware.exclude()` call and `tenant-context.middleware.ts`'s
`EXPECTED_FALLBACK_PATH_SUFFIXES`/`isExpectedBrandingFallback` both encode the same concept — "this
route legitimately runs without auth context" — as two separately-maintained lists with no single
source of truth. Both files' own comments already admit the risk: a route added to one list and not
the other produces a spurious "Tenant context fallback to headers detected" warning on every
legitimate call to it, forever, until someone notices.
**What to do:** consolidate into one shared list (e.g. exported from `@hospital/tenant-context` and
imported by `app.module.ts`) so a new unauthenticated route only needs updating in one place.
**Verify:** adding a new unauthenticated route requires exactly one code change, not two.
**Test:** n/a — a refactor of existing wiring, covered by the existing auth-wiring integration specs.

**Confirmed manifestation (2026-08-23, `/code-review high` on 2.21/2.22):** `PlatformBrandingController`'s
JWT-protected admin route (`platform/tenants/:hospitalId/branding`) already collides with
`EXPECTED_FALLBACK_PATH_SUFFIXES`' `endsWith('/branding')` check — meant only for the public
unauthenticated tenant route — so a future `AuthContextMiddleware` failure on the admin path would
have its spoofing-anomaly warning silently suppressed instead of logged. Not urgent (no live
exploit today, `AuthContextMiddleware` has never failed to populate `authContext` there), but
raises the priority of the consolidation above whenever this item is next picked up.

---

## 4. Improvements (low-risk, opportunistic)

### 4.1 Seed-demo-data: add a subscription for the demo tenant

**Status: done.** In `database/seed-demo-data.ts`, provisions basic monthly subscription & issues one open invoice for demo tenant if not already present.

### 4.2 Notifications shell wiring (do 2.6 first)
**Status: done** — found already built while picking up 2.6 (2026-08-22). `shell-chrome.ts`'s
`unreadCount` signal is set from `GET /notifications/summary` and rendered as a badge on the bell
(`shell-chrome.html`, `@if (unreadCount() > 0)`); "View all notifications" routes to `/notifications`.

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
