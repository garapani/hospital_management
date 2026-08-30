# MVP Status Audit — Built vs. PRD Scope

**Original audit:** 2026-08-09 (see git history for the v1 table; this file is a point-in-time
audit by design — re-run rather than trust blindly once the picture shifts).
**Refresh:** 2026-08-24 (DeepSeek Harness end-to-end MVP review — module inventory verified against
`apps/api/src`, the live route surface, the full test suite, and `pending-tasks.md` check-offs).

Audit target: `new/code/apps/api/src/*` against `PRD.md` §5 (module descriptions) and §8 (phase
table). `pending-tasks.md` only tracks work from PRD Phase 2 onward; Phase 0/1 modules were built
earlier and never got checklist entries — the table below is the authoritative "what exists".

## Summary table (2026-08-24 refresh)

| Module (dir) | PRD phase | Wired into `AppModule`? | Status | Key gaps / notes |
|---|---|---|---|---|
| `auth` | Phase 0 | Yes | Done | Login/refresh/change-password, JWT + refresh, tenant-status gate, purge-safe login (2.32). **2026-08-30 module pass:** logout is local-only (frontend no longer calls the nonexistent `/auth/logout` — server-side revocation deferred to new-features #22), username inputs capped at 255 chars |
| `accounts` | Phase 0 | Yes — transitively via `AuthModule` | Done | Staff CRUD, deactivate/reactivate/unlock, roles, reset-password, must-change flow, no self-service password reset/email. **2026-08-30 module pass:** role startDate/endDate now @IsDateString (400 not 500), password fields capped at bcrypt's 72, email @IsEmail + length caps. **Known:** user list not paginated (>50 staff invisible; backend caps at 100) |
| `rbac` | Phase 0 | N/A — entities + seed + guards | Done | `Role`/`Permission`/`RolePermission` + `seed-rbac-catalog.ts`, consumed by `@hospital/auth-guards`. **2026-08-30 module pass:** permission-drift check clean (every @RequirePermission in code is seeded); role catalog management is API-only (`rbac.manage`) — no platform UI, acceptable for MVP |
| `master-data` | Phase 0 | Yes | Done | Departments/wards/beds; read-only open to all authenticated staff (2026-08-21 fix); global dept catalog is platform-side (`rbac.manage`). **2026-08-30 module pass:** fixed the seed grant gap — Receptionist / Front Desk now has `master-data.read` (was 403 on department/ward/bed lookups) |
| `tenants` | Phase 0 | Yes | Done | Provision/archive/suspend/purge (tombstone, transactional), platform audit trail, package assignment. **2026-08-30 module pass:** SetTenantRolesDto.roleIds @IsUUID, hospitalId capped at 56 (Postgres 63-char schema-name limit), plus a public-schema purity guard spec (tenant tables/baselines must never land in `public`) |
| `audit` | Phase 0 | Yes | Done | Per-tenant `audit_records`, actor/recordId derivation, query UI. **2026-08-30 module pass:** clean — well-validated search DTO, `audit.read` guarded, UI present |
| `patients` | Phase 1 | Yes | Done | Full CRUD + duplicate-check endpoint |
| `appointments` | Phase 1 | Yes | Done | CRUD + doctor-schedule/department-capacity endpoints + conflict checks. **F5:** create/update take bare-interface bodies — malformed input 500s instead of 400 (no DTO validation) |
| `admissions` | Phase 1 | Yes | Done | Create/list/get/transfer/discharge + discharge summaries (migration 0030). **F1:** `GET /admissions/discharge-summaries` list route swallowed by `@Get(':id')` → 500 |
| `billing` | Phase 1 | Yes | Done | Invoices/deposits/returns/record-payment + **automatic charge-capture** from Lab/Radiology/Pharmacy (2026-08-20, `ChargeCaptureSubscriber`). Settlement deliberately deferred to Insurance & Claims (per original Billing spec) |
| `orders` | Phase 1 | Yes | Done | Central order placement, routes to Lab/Radiology/Pharmacy, completion routing via `completeItemInTransaction` |
| `reporting` | Phase 1 (archiver) + Phase 6 | Yes | Done (ahead) | Event archiver + read APIs + CSV/PDF export; frontend dashboard page exists. Full aggregation UI is partial (frontend reporting page ships what exists) |
| `clinical/vitals` | Phase 4 | Yes | Done | Full CRUD |
| `clinical/encounters` | Phase 4 | Yes | Done | Notes/diagnoses/prescriptions (create + patient-scoped list) |
| `clinical/triage` | Phase 4 | Yes | Done | Create/list/get/update/link-patient; covers PRD's Emergency module (ER intake/triage) |
| `lab` | Phase 2 | Yes | Done | Catalog, requisition workflow, verify, PDF export, charge capture. Future: instrument/LIS integration, external send-out, multi-level verification, amendment history |
| `radiology` | Phase 2 | Yes | Done | Same shape as Lab; PDF export. Future: image attachment, film billing, DICOM, amendment history |
| `inventory` | Phase 2 | Yes | Done | Item A (procurement: categories/items/vendors/PO/goods receipt/stock) + Item B (requisition/dispatch). Future: RFQ, staging, store/location, donations/returns |
| `pharmacy` | Phase 2 | Yes | Done | Order-routed dispensing, FEFO stock decrement, charge capture. Future: walk-in/OTC, drug catalog, POS, controlled-substance log |
| `ward-supply` | Phase 2 | Yes | Done | Ward sub-store stock ledger (receive/consume, per-department+item balances) |
| `insurance` | Phase 3 | Yes | Done (MVP scope) | Payers/policies/claims lifecycle + coverage check; frontend page (2026-08-22). Future: external referrals, PM-JAY formats, payer settlement |
| `accounting` | Phase 3 | Yes | Done (MVP scope) | CoA, double-entry journals, trial balance/income statement/balance sheet; no frontend page. Future: **auto-posting from Billing** (`claude-code-tasks.md` 2.8), reversals, fiscal-year close |
| `fixed-assets` | Phase 3 | Yes | Done (MVP scope) | Register + read-time straight-line depreciation. Future: accrual schedules, disposal, transfers (2.9) |
| `verification` | Phase 3 | No | **Not started** | Overlaps insurance `checkCoverage`; needs scoping decision |
| `nursing` | Phase 4 | Yes | Done | Tasks + MAR |
| `ot` | Phase 4 | Yes | Done | Surgery scheduling |
| `maternity` | Phase 4 | Yes | Done | Labor/delivery records |
| `cssd` | Phase 4 | Yes | Done | Instrument catalog + sterilization cycles |
| `vaccination` | Phase 4 | Yes | Done | Patient vaccination records |
| `employee` | Phase 5 | Yes | Done | HR master (auto EMP-… numbers) |
| `payroll` | Phase 5 | Yes | Done | Monthly payslips (Draft→Paid) |
| `fraction` | Phase 5 | Yes | Done | Revenue-share rules + entries vs real invoices |
| `helpdesk` | Phase 6 | Yes | Done | Ticketing lifecycle |
| `marketing` | Phase 6 | Yes | Done | Referral sources + patient referrals |
| `ssu` | Phase 6 | Yes | Done — backend only | **M1:** no frontend page (only backend-complete module missing one) |
| `notifications` | Phase 6 | Yes | Done (in-app slice) | CRUD + summary + subscribers; no email/SMS/push channel |
| `document-and-print` | Phase 6 | No | Partial | PDF export exists via `@hospital/pdf` (lab/radiology/reporting); no module for stickers/print |
| `dicom` | Phase 2 | No | **Not started** | Needs scoping (`claude-code-tasks.md` 2.10) |
| `patient-portal` | new (PRD §6.1) | Yes | Phase 1 backend done (2026-08-23) | Login + read-only self-scoped records. **M2:** frontend app is an empty scaffold; Phase 2-4 (booking/payment/messaging) deferred, payment blocked on gateway vendor |
| `packages` | SaaS | Yes | Done | Package catalog + resolution-time permission filtering + role auto-provisioning |
| `platform-billing` | SaaS | Yes | Done | Subscriptions + invoices (subscribe/cancel/issue/mark-paid), tenant-locked |
| `platform-branding` | SaaS | Yes | Done | Per-tenant display name/logo/color, MinIO-backed, XSS-hardened |

## Surprises / discrepancies (kept from the original audit + 2026-08-24 additions)

### The `accounts` module is NOT dead code — it's wired transitively, not directly (unchanged)
`app.module.ts` never imports `AccountsModule` directly, but `auth/auth.module.ts` imports it, and
NestJS module resolution is transitive — all `AccountsController` routes are live. **No action
needed** — this was a false alarm in the original audit; correcting the record so it doesn't get
"fixed" by someone re-wiring an already-wired module.

### Phase 1 predates `pending-tasks.md`'s tracking regime entirely (unchanged)
Patient/Appointment/Admission/Billing/Clinical-basics were built in the project's earliest commits,
before the current pending-task pipeline existed — that's why they appear in no checklist entries,
not because they were skipped. Same explanation covers appointments' F5 validation gap and
admissions' F1 route collision (oldest modules, least hardening).

### Reporting shipped ahead of its PRD phase slot (unchanged)
Read APIs + exports + dashboard page exist; the PRD's "full aggregation/UI" Phase 6 wording is
partially already satisfied. Don't re-schedule done work.

### Automatic charge-capture — RESOLVED (was a surprise in the 2026-08-09 audit)
The original audit's "no automatic charge-capture from clinical modules into Billing" is fixed
(2026-08-20): pricing columns + `ChargeCaptureSubscriber` + `InvoicesService.captureChargeForOrderItem`
(auto-line on the patient's open invoice when an order item completes), with per-patient advisory
locking and a unique partial index making "one charge per order item" a DB invariant.

### 2026-08-24 review findings (new)
The end-to-end MVP review found two live-environment blockers and five code bugs, plus missing
frontend features — full write-ups with acceptance criteria live in `claude-code-tasks.md` §6
(F1–F5, M1–M2). The headline items:
- **Login-blocking migration gap (B1/F4):** tenant migration 0057 (`accounts.patientId`) landed
  without `api:migrate-tenants` backfill — every pre-existing tenant schema lacked the column and
  every login 401'd. Unblocked in dev by cleanup + backfill; the process gap (undetectable by the
  suite, which only tests fresh schemas) is tracked as F4.
- **`migrate-tenants` crashes on purged tenants (F3):** iterates all registry rows; purged
  tombstones have no schema → falls through to `public` and replays migrations there. Also breaks
  the prod `docker-compose.prod.yml` `migrate` service (`migrate.ts && migrate-tenants.ts`).

## What's genuinely not built (for MVP scope decisions)

- **DICOM** (needs scoping), **Verification** (overlaps insurance), **Document & Print module**
  (PDF export exists; no sticker/print surface), **full Notification channels** (in-app only).
- **Patient-portal frontend** (backend Phase 1 done; app scaffold empty) — needs a scope decision.
- **SSU frontend page** — backend done, page missing.
- Ops-readiness items tracked in `claude-code-tasks.md` 2.1–2.4 (load test/sizing, OTel tracing +
  Grafana/Loki, per-tenant connection caps, WAL/PITR + self-owned-server runbook).
