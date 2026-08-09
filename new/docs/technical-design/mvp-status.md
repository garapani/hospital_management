# MVP Status Audit — Built vs. PRD Scope

Audit target: `new/code/apps/api/src/*` against `PRD.md` §5 (module descriptions) and §8 (phase
table). Triggered by two surprises found during a planning discussion (see "Surprises /
discrepancies" below) that made `pending-tasks.md` alone untrustworthy as a map of "what's done" —
`pending-tasks.md` only tracks work from PRD Phase 2 onward; Phase 0/1 modules were built earlier
and never got checklist entries.

## Summary table

| Module (dir) | PRD phase | Wired into `AppModule`? | Status | Key gaps |
|---|---|---|---|---|
| `auth` | Phase 0 | Yes (direct import) | Done | Login + refresh only, matches JWT-auth plan scope |
| `accounts` | Phase 0 (Identity & Access) | **Yes — transitively**, via `AuthModule` importing `AccountsModule` (`auth.module.ts:9,15`), not a direct `app.module.ts` import | Done | Staff account CRUD, deactivate/reactivate/unlock, role assign/unassign. No self-service password reset/email flow |
| `rbac` | Phase 0 (Identity & Access) | N/A — entities + seed script only, no controller | Done for its scope | `Role`/`Permission`/`RolePermission` entities + `seed-rbac-catalog.ts`; consumed by `PermissionGuard` in `libs/auth-guards`, not a standalone module |
| `master-data` | Phase 0 | Yes | Done for what exists | Single controller/service — departments etc.; scope vs. PRD's full "lookups/code tables" breadth not verified line-by-line |
| `tenants` | Phase 0 (System Admin) | Yes | Done | Tenant provisioning confirmed elsewhere (`pending-tasks.md` Phase 1 item 3) |
| `audit` | Phase 0 | Yes | Done | Per `pending-tasks.md`, one known-flaky unrelated test (`persisting-reporting-event-publisher` logging assertion) |
| `patients` | Phase 1 | Yes | Done | Full CRUD + duplicate-check endpoint |
| `appointments` | Phase 1 | Yes | Done | Create/list/get/update/cancel — no visible reschedule-vs-cancel distinction or doctor-schedule/availability endpoints (PRD mentions "doctor schedules" as in-scope for this module) |
| `admissions` | Phase 1 (Admission/ADT) | Yes | Done | Create/list/get/transfer/discharge. PRD also names "discharge summaries" (`DischargeSummaryController` in old system) — no distinct discharge-summary entity/endpoint found, only a `discharge` action |
| `billing` | Phase 1 | Yes | Partially done | Invoice create/list/get/cancel/record-payment, deposit create/list/refund, billing settings incl. GST. **Missing:** Settlement and Return/credit-note concepts (PRD: "invoicing, deposits, **settlements**"; old system also had `Controllers/Billing/Return`) — zero matches for "Settlement"/"IpBilling"/"inpatient" in the module. Invoice line items link to `sourceOrderItemId` but it's client-supplied and optional — no automatic charge-capture trigger when Lab/Radiology/Pharmacy work completes |
| `orders` | Phase 1 | Yes | Done | Central order placement/list, per `pending-tasks.md` |
| `reporting` | Phase 1 (archiver) + Phase 6 (dashboard) | Yes | Ahead of schedule | Archiver (`persisting-reporting-event-publisher`, `reporting.subscriber.ts`) plus read APIs (`GET /reporting/events`, dashboard event-counts/revenue) already shipped — PRD scoped the full dashboard to Phase 6, but the read-API slice landed early per `pending-tasks.md` Phase 4 item 10. **Not done:** CSV/PDF export (explicitly deferred, per `pending-tasks.md`) |
| `clinical/vitals` | Phase 4 (Clinical/EMR) | Yes | Done, but early | Full CRUD |
| `clinical/encounters` | Phase 4 (Clinical/EMR) | Yes | Done, but early | Notes/diagnoses/prescriptions, each with create + patient-scoped list; diagnoses/prescriptions are create+delete only (no update) |
| `clinical/triage` | Phase 4 (Emergency, arguably) | Yes | Done, but early | Create/list/get/update/link-patient |
| `lab` | Phase 2 | Yes | Done (per `pending-tasks.md`, `[x]`) | Report/PDF export, instrument integration, external send-out, multi-level verification, catalog update/delete, result amendment history, `OrderItem.status` not advancing on verify — all already logged in `pending-tasks.md`, not re-discovered here |
| `radiology` | Phase 2 | Yes | Done (per `pending-tasks.md`, `[x]`) | Image attachment, film billing, DICOM, report PDF, catalog update/delete, amendment history, `OrderItem.status` — already logged in `pending-tasks.md` |
| `inventory` | Phase 2 | Yes | Done (per `pending-tasks.md`, `[x]`) | RFQ, two-phase staging, store/location dimension, vendor accounting fields, donations/returns, catalog update/delete — already logged |
| `pharmacy` | Phase 2 | Yes | Done (per `pending-tasks.md`, `[x]`) | Walk-in/OTC sales, dispensing-verification step, drug-specific catalog, POS/checkout, controlled-substance logging — already logged |
| `assets` | Phase 3 (Fixed Asset) | No | **Not started** | Directory contains only `.gitkeep` |
| — (no dir) | Phase 2 — DICOM | — | Not started | Confirmed no `dicom` directory |
| — (no dir) | Phase 2 — Ward Supply | — | Not started | Confirmed no `ward-supply` directory |
| — (no dir) | Phase 3 — Insurance/Claims | — | Not started | No `insurance`/`claims` directory |
| — (no dir) | Phase 3 — Accounting | — | Not started | No `accounting` directory (`accounts/` is Identity & Access, unrelated — see discrepancy below) |
| — (no dir) | Phase 3 — Verification | — | Not started | No `verification` directory |
| — (no dir) | Phase 4 — Nursing, Emergency, OT, Maternity, CSSD | — | Not started | No matching directories. Triage (`clinical/triage`) is arguably a slice of Emergency, but PRD lists Emergency as its own module ("ER intake, triage") — ambiguous whether triage-as-built satisfies it or is a partial slice |
| — (no dir) | Phase 5 — Employee, Payroll, Fraction & Incentive | — | Not started | No matching directories |
| — (no dir) | Phase 6 — Helpdesk, Marketing & Referral, Social Service Unit, Notification, Document & Print | — | Not started | No matching directories |

## Surprises / discrepancies

### The `accounts` module is NOT dead code — it's wired transitively, not directly

The planning discussion that triggered this audit flagged `apps/api/src/accounts/` as orphaned
because `app.module.ts` never imports `AccountsModule` directly. That's true but misleading:
`auth/auth.module.ts:9` imports `AccountsModule`, and `auth.module.ts` is itself imported directly
into `app.module.ts:8/46`. NestJS's module resolution is transitive — any module reachable through
the `imports` graph from the root module has its controllers registered. `AccountsModule` declares
`AccountsController` (`accounts.module.ts:9`), so `POST /accounts`, `GET /accounts`,
`PATCH /accounts/:id/{deactivate,reactivate,unlock}`, `POST /accounts/:id/roles`, and
`DELETE /accounts/:id/roles/:accountRoleId` are all live routes today. **No action needed** — this
was a false alarm, not a real gap. Correcting the record here so it doesn't get "fixed" by someone
re-wiring an already-wired module.

### Phase 1 predates `pending-tasks.md`'s tracking regime entirely

`git log --follow` on `accounts.controller.ts` and `admissions.module.ts`/`billing.module.ts` shows
these were built in the project's earliest commits (e.g. `e947d51`, `15a8801`, `d0e50d2`,
`7c67776`, `a37f6dd`), before the rename `apps/identity-access` → `apps/api` for the
modular-monolith pivot (`8473f3d`) — i.e. before the current pending-task pipeline (brainstorm →
plan → subagent-execute → docs) was even established as this repo's working convention. That's why
none of Patient/Appointment/Admission/Billing/Clinical-basics appear as checklist items anywhere in
`pending-tasks.md`: the file's scope starts at PRD Phase 2 by construction, not because Phase 0/1
were skipped.

### Reporting shipped ahead of its PRD phase slot

PRD §8 scopes the "full aggregation/dashboard UI" to Phase 6, but the read APIs
(`GET /reporting/dashboard/event-counts`, `GET /reporting/dashboard/revenue`) already exist per
`pending-tasks.md` Phase 4 item 10. Not a problem — just note that "Phase 6 — Reporting" in the PRD
phase table is partially already satisfied, so a future MVP-scoping pass shouldn't re-schedule work
that's done.

### No automatic charge-capture from clinical modules into Billing

`InvoiceItem.sourceOrderItemId` (`billing/entities/invoice-item.entity.ts:13`) is optional and
supplied by the caller on invoice creation (`create-invoice.dto.ts:8`) — there's no subscriber or
service call that automatically creates a billing charge when a Lab/Radiology/Pharmacy workflow
step completes. For a real registration→visit→bill flow, front-desk/billing staff would need a
manual step (or a UI that reads completed order items and lets staff select them) rather than
charges appearing automatically. Not logged anywhere else in `pending-tasks.md` — worth its own
future item if the target workflow assumes auto-capture.

## Candidates for MVP-track hardening

Modules that are close to a genuinely usable registration→visit→bill→lab/pharmacy flow for a
single hospital, needing only targeted fixes rather than new build:

1. **Billing** — closest to "needs real work before go-live," not just polish: no Settlement/Return
   concept, no automatic charge capture from clinical modules (see above). Given Billing is the
   PRD's stated proof of "registration → visit → bill," this is the highest-leverage gap to close
   for an actual MVP, ahead of any Phase 3 (Insurance/Accounting) work.
2. **Appointments** — solid CRUD; missing doctor-schedule/availability endpoints the PRD's module
   description implies ("doctor schedules"). Worth confirming whether the target MVP workflow
   actually needs scheduling-conflict checks or just appointment records.
3. **Admissions** — solid CRUD; missing a distinct discharge-summary artifact (PRD names it
   explicitly via the old system's `DischargeSummaryController`). Low effort if needed.
4. **Lab / Radiology / Inventory / Pharmacy** — already `[x]` in `pending-tasks.md` with gaps
   explicitly named there; no new findings here beyond what's already tracked.
5. **Fixed Asset, Insurance/Claims, Accounting, Verification, Nursing, Emergency, OT, Maternity,
   CSSD, DICOM, Ward Supply, Employee, Payroll, Fraction & Incentive, Helpdesk, Marketing &
   Referral, Social Service Unit, Notification, Document & Print** — genuinely not started, zero
   source directories. Any MVP scope decision should explicitly name which (if any) of these are
   actually required, rather than assuming Phase-numbered order implies necessity.
