# Feature-by-Feature Code Review Findings (2026-08-25)

Read-only domain review of `apps/api/src` against `PRD.md` and `Development-Standards.md`, run as
4 parallel passes (Clinical & Patient Care / Diagnostics & Supply Chain / Financial & Billing /
Platform & Admin). No code changed. Cross-cutting items already tracked in `new-features.md`
(JWT auth, DB tenant isolation, Nx boundaries, Redis, MinIO, observability, deployment, backups)
are excluded.

Checklist for working through one item at a time — check items off as they're fixed. Not yet
sequenced into `pending-tasks.md`; do that per item as it's picked up, per the dev pipeline in
the root `CLAUDE.md`.

**Totals: 19 P1 &middot; ~65 P2 &middot; ~45 P3**

- P1 = correctness/security bug with a concrete failure scenario
- P2 = meaningful gap or missing test on a real code path
- P3 = minor/cleanup

---

## Clinical & Patient Care

### patients
- [x] **P2** — PATCH silently ignores address/next-of-kin edits. `UpdatePatientDto` accepts `addresses`, `kins`, `allowDuplicate`, but the service only copies 11 scalar fields onto the entity — client gets 200 OK, record unchanged. (`patients/dto/update-patient.dto.ts:57-71`, `patients/patients.service.ts:131-141`) — **Fixed 2026-08-26:** `update()` now replaces the full `addresses`/`kins` arrays (delete-then-recreate, same full-replace semantics as `create()`) whenever the DTO includes them.
- [x] **P2** — Deactivated patient keeps a working portal login. `deactivate()` only flips `Patient.isActive`; never deactivates the linked portal account, and `getMe()` doesn't check `isActive` either. (`patients/patients.service.ts:162-173`, `accounts/accounts.service.ts:409`, `patient-portal/patient-portal.service.ts:57-67`) — **Fixed 2026-08-26:** `deactivate()` now also calls a new `AccountsService.deactivatePatientAccount()` (no-op if the patient never had a portal account), which blocks future logins; `PatientPortalService.getMe()` now filters on `isActive: true` too, so an already-issued session can't keep reading a deactivated patient's own profile through it.
- [x] **P3** — Duplicate-patient check is select-then-insert with no backing constraint. (`patients/patients.service.ts:44-59`) — **Fixed 2026-08-26:** a hard unique constraint isn't an option (`allowDuplicate` is a deliberate, supported override, so uniqueness on phone or name+dob can't be unconditional); `create()` now takes a `pg_advisory_xact_lock` (via the existing `withAdvisoryLock` util) keyed on the same identity signature the duplicate check uses, inside the same transaction as the check-and-insert, so concurrent requests for the same identity serialize instead of both observing "no duplicate."
- [x] **P3** — `check-duplicates` endpoint body is an inline object literal, bypassing `ValidationPipe` entirely. (`patients/patients.controller.ts:22`) — **Fixed 2026-08-26:** added `CheckDuplicatesDto` and used it as the endpoint's body type.

### admissions
- [x] **P1** — A patient can hold two concurrent active admissions. `admit()` checks the bed is free but never checks whether the patient is already `Admitted` elsewhere; unique index only covers `bedId`. (`admissions/admissions.service.ts:88-166`, `migrations/0014-create-admissions-tables.ts:28-30`) — **Fixed 2026-08-25:** added an in-transaction pre-check plus a partial unique index (`UQ_admissions_active_patient` on `(patientId) WHERE status='Admitted'`, migration 0062) as a race-safety backstop, mirroring the existing bed constraint; `admit()` now maps that constraint to a 409.
- [x] **P2** — `transfer()` turns the bed race into a raw 500 instead of a 409 (no `23505` handler, no row lock), unlike `admit()`. (`admissions/admissions.service.ts:206-253`) — **Fixed 2026-08-26:** `transfer()` now catches a `UQ_admissions_active_bed` constraint violation on the admission save (same pattern as `admit()`) and maps it to a 409 instead of letting it surface as a raw 500.
- [x] **P2** — `admit()` never checks the triage entry belongs to the patient being admitted — mismatched ids silently close the wrong ER record. (`admissions/admissions.service.ts:96-107,159-162`) — **Fixed 2026-08-26:** `admit()` now rejects with a 400 when `sourceTriageEntryId`'s linked patient doesn't match `patientId`.
- [x] **P2** — A reviewed discharge summary stays editable and re-reviewable forever — no `reviewedAt` guard. (`admissions/admissions.service.ts:358-398`) — **Fixed 2026-08-26:** both `updateDischargeSummary` and `reviewDischargeSummary` now reject with a 409 once `reviewedAt` is set.
- [x] **P2** — `discharge_summaries.admissionId` has no unique index — the "already exists" check races under concurrency. (`admissions/admissions.service.ts:299-302`, `migrations/0030-create-discharge-summary-table.ts:14-37`) — **Fixed 2026-08-26:** added `UQ_discharge_summaries_admission` (migration 0065) as a race-safety backstop for the existing `createDischargeSummary` pre-check, mirroring the `UQ_admissions_active_bed`/`UQ_admissions_active_patient` pattern.
- [x] **P3** — Initial-admission bed transfer records a client-supplied doctor id instead of `resolveActor()`, unlike the sibling `transfer()`. (`admissions/admissions.service.ts:154,246`) — **Fixed 2026-08-26:** the initial-admission `BedTransfer` now records `resolveActor(input.admittingDoctorId)`, matching `transfer()`.
- [x] **P3** — Two competing "discharge summary" representations (`Admission.dischargeSummary` vs `DischargeSummary` entity) with no reconciliation. (`admissions/entities/admission.entity.ts:46-47`, `discharge-summary.entity.ts`) — **Fixed 2026-08-26:** no behavior change (a schema/data-model merge is a bigger call than a P3 cleanup warrants) — documented the distinction on both entities so a future reader doesn't conflate the free-text discharge-time note with the structured, reviewable summary.

### appointments
- [x] **P1** — `update()` is an unguarded `Object.assign` that bypasses every booking rule: free-text status (no state machine), and reschedules through this path skip both the doctor-conflict and department-capacity checks `create()` enforces — the only way to double-book a doctor. (`appointments/appointments.service.ts:109-119`, `dto/update-appointment.dto.ts:40-42`) — **Fixed 2026-08-25:** removed `status` from the update DTO/interface entirely (cancellation is the only sanctioned status transition, via `POST /:id/cancel`); a cancelled appointment now rejects any update; a reschedule (date/time/doctor/department change) re-runs the doctor-conflict and department-capacity checks, excluding the appointment's own row.
- [x] **P2** — Doctor double-booking check has no supporting index or constraint — select-then-insert only. (`appointments/appointments.service.ts:56-88`, `migrations/0009-create-appointments-table.ts:7-25`) — **Fixed 2026-08-26:** added `UQ_appointments_active_doctor_slot` (migration 0066, partial unique on `(doctorId, appointmentDate, appointmentTime) WHERE status='Scheduled' AND doctorId IS NOT NULL`); both `create()` and `update()` now map a `23505` on that constraint to a 409, matching the admissions pattern.
- [ ] **P2** — Doctor availability is a hardcoded 16-slot constant, not a real schedule. (`appointments/appointments.service.ts:165-187`) — **Deferred 2026-08-26:** a real fix means modeling actual doctor working hours/shifts, which doesn't exist anywhere in this codebase — net-new feature, not a batch-sized fix. Captured as `new-features.md` #18.
- [x] **P2** — The module's only two business rules (slot conflict, capacity ceiling) are entirely untested. (`appointments.service.integration-spec.ts:32-123`) — **Fixed 2026-08-26:** added direct `create()`-path tests for both rules (previously only covered via the `update()`/reschedule path) plus a `cancel()`-idempotency test.
- [x] **P3** — `cancel()` has no status guard; body skips `ValidationPipe` (inline object literal). (`appointments/appointments.service.ts:121-136`, `appointments.controller.ts:40`) — **Fixed 2026-08-26:** `cancel()` now rejects an already-cancelled appointment with a 409; added `CancelAppointmentDto` and used it as the endpoint's body type.
- [x] **P3** — `patientId` is never checked to exist. (`appointments/appointments.service.ts:46-96`) — **Fixed 2026-08-26:** `create()`/`update()` now 404 when a supplied `patientId` doesn't resolve to a real patient. Note: this needed a new `domain:appointments` → `domain:patients` module-boundary policy in `eslint.config.mjs` (mirroring the existing admissions/billing/orders edges); the repo's config-file guard hook unconditionally blocks Claude from editing that file, so the policy addition itself is still pending a human edit — `nx lint` will flag the new import until then (`nx lint` isn't part of CI, so this doesn't block anything today).

### clinical / encounters
- [x] **P1** — `doctorId` on notes/diagnoses/prescriptions is client-supplied — `EncountersService` doesn't inject `TenantContextService` at all, unlike every sibling clinical module. (`clinical/encounters/encounters.service.ts:17-19,22-28,49-55,76-82`, `dto/encounter.dto.ts:11-12,61-62,85-86`) — **Fixed 2026-08-25:** `EncountersService` now injects `TenantContextService`; `doctorId` on notes/diagnoses/prescriptions is derived from the authenticated account (`resolveActor`, same pattern as admissions/nursing/ot), with the caller-supplied value only used as a fallback for non-HTTP callers with no tenant context. DTOs' `doctorId` made optional accordingly.
- [x] **P2** — Clinical notes have a `status` field with no lifecycle or lock — a signed note remains fully editable forever (`updateNote` is a plain `Object.assign`). (`entities/clinical-note.entity.ts:30-31`, `encounters.service.ts:30-40`) — **Fixed 2026-08-26:** `updateNote()` now rejects any further edit with a 409 once `status === 'Signed'`, matching the discharge-summary `reviewedAt` lock pattern; the transition into `'Signed'` itself is unaffected (status is still `'Draft'` at the point the guard runs).
- [x] **P2** — No patient-existence check on note/diagnosis/prescription creation. (`encounters.service.ts:22,49,76`) — **Fixed 2026-08-26:** all three `create*` methods now 404 on a `patientId` that doesn't resolve to a real patient. Needed a new `domain:clinical-encounters` → `domain:patients` module-boundary policy in `eslint.config.mjs`; same as the appointments P3 fix above, the repo's config-file guard hook unconditionally blocks Claude from adding it, so that one policy block is still pending a human edit (`nx lint`, not part of CI, will flag it until then).
- [x] **P2** — `Prescription.status` can never change after creation — no discontinue/complete path, nothing for Nursing's MAR to reference. (`entities/prescription.entity.ts:36-37`, `encounters.controller.ts:51-68`) — **Fixed 2026-08-26:** added `discontinuePrescription`/`completePrescription` (only valid from `Active`, 409 otherwise) plus `POST /encounters/prescriptions/:id/discontinue|complete`. The MAR-linkage half of this finding is nursing's own separate item below — left for that module.
- [x] **P3** — Every per-patient read (notes/diagnoses/prescriptions) is unbounded, no pagination. (`encounters.service.ts:42-46,69-73,97-101`) — **Fixed 2026-08-26:** all three now go through `@hospital/pagination`'s `paginate()`/`PaginationQueryDto`, same pattern as the nursing P1 fix; controllers accept `page`/`limit` query params.

### clinical / triage
- [x] **P2** — `linkPatient` validates nothing — no existence check, no re-link guard, no closed-entry guard; a mis-link propagates straight into `AdmissionsService.admit`. (`clinical/triage/triage.service.ts:91-104`) — **Fixed 2026-08-26:** `linkPatient` now 404s on a nonexistent `patientId`, and 409s both on an already-linked entry (re-link) and on a closed entry (Discharged/Admitted/Deceased).
- [x] **P2** — `update()` can re-point an entry to a different patient or reopen a closed one (`Object.assign` over the whole DTO incl. `patientId`/`status`). (`triage.service.ts:72-89`, `dto/update-triage-entry.dto.ts:4-6,61-63`) — **Fixed 2026-08-26:** `patientId` removed from `UpdateTriageEntryInput`/`UpdateTriageEntryDto` entirely (mirroring the appointments P1 fix's removal of `status`) — `linkPatient` is now the only path that sets it. `update()` also 409s on any edit to an already-closed entry (guard checks status *before* applying the input, so the transition *into* a closed status itself is unaffected).
- [x] **P3** — `acuityLevel` has `@Min(1)` but no `@Max(5)` — garbage values sort below real patients on the ESI queue. (`dto/create-triage-entry.dto.ts:43-46`, `triage.service.ts:112`) — **Fixed 2026-08-26:** added `@Max(5)` to both DTOs.
- [x] **P3** — `TriageEntry` is the only entity with no audit columns (`createdBy`/`updatedBy`/`deletedBy`). (`entities/triage-entry.entity.ts:10,64-68`) — **Fixed 2026-08-26:** migration 0053 (the broad audit-columns backfill) missed `triage_entries` — added migration 0067 to close that gap, and `TriageEntry` now extends `SoftDeletableEntity` like every sibling clinical entity instead of duplicating its own `createdAt`/`updatedAt` columns.

### clinical / vitals
- [x] **P2** — Zero range validation on any vital sign against narrow `decimal` columns — mistyped values silently truncate or throw raw 500 overflow; SpO2/pain scale/BP sanity unchecked. (`dto/create-vital.dto.ts:11-45`, `entities/vital.entity.ts:15-43`) — **Fixed 2026-08-26:** added `@Min`/`@Max` to every vital-sign field on both DTOs at clinically plausible bounds (height 0-300cm, weight 0-500kg, temperature 20-45°C, pulse/bpSystolic 0-300, bpDiastolic/respiratoryRate 0-200/0-100, spO2 0-100, painScale 0-10), all comfortably inside their `decimal(5,2)`/`decimal(4,1)` columns' overflow ceiling; switched the integer-typed columns (pulse/bpSystolic/bpDiastolic/respiratoryRate/painScale) from `@IsNumber` to `@IsInt`.
- [x] **P2** — `calculateBmi` can overflow its own column (e.g. height:1, weight:100 → BMI 1,000,000 vs `decimal(5,2)`). (`vitals.service.ts:15-22`) — **Fixed 2026-08-26:** `calculateBmi` now returns `undefined` (no BMI recorded) instead of a value exceeding `decimal(5,2)`'s 999.99 ceiling, rather than letting `save()` throw a raw Postgres overflow error.
- [x] **P3** — A stale BMI can't be cleared on update (`undefined` skipped by `save()` instead of nulling). (`vitals.service.ts:60-62`) — **Fixed 2026-08-26:** `update()` now assigns `calculateBmi(...) ?? null` instead of a bare `undefined`, so a height/weight combo that no longer yields a BMI actually nulls the column instead of leaving the previous value in place.
- [x] **P3** — `listByAppointment` is dead code. (`vitals.service.ts:77-84`) — **Fixed 2026-08-26:** deleted (no controller route, no other caller, no test coverage).

### nursing
- [x] **P1** — `page`/`limit` are silently stripped from both list endpoints (task list and MAR) — permanently pinned to page 1, rows past 20 unreachable with no error. (`nursing/dto/nursing.dto.ts:22-26,51-55`, `app/api-validation-pipe.ts:19`) — **Fixed 2026-08-25:** `ListTasksQueryDto`/`ListAdministrationsQueryDto` now extend `PaginationQueryDto`; added a controller-level e2e spec proving `page`/`limit` survive the real `ValidationPipe`. Also fixed collateral test-fixture breakage in nursing/maternity specs that reused one hardcoded `patientId` across multiple raw-inserted admissions, now that a patient can't hold two active admissions (item above).
- [x] **P2** — A skipped medication dose records no actor (`administeredBy` null, no `skippedBy` column). (`nursing/nursing.service.ts:187-231`) — **Fixed 2026-08-26:** added a `skippedBy` column (uuid, matching the sibling `administeredBy`/`completedBy` actor columns); `skipAdministration()` now records `resolveActor(actor)` there.
- [x] **P2** — `MedicationAdministration` has no audit columns, unlike sibling `NursingTask` in the same file. (`entities/nursing.entity.ts:10,45,76-81`) — **Fixed 2026-08-26:** migration 0053's audit-columns backfill covered `nursing_tasks` but never `medication_administrations` — added migration 0068 with the same shape, and switched the entity to extend `SoftDeletableEntity`.
- [x] **P2** — The MAR has no link to a prescription — nothing ties a dose to what authorized it. (`entities/nursing.entity.ts:44-74`) — **Fixed 2026-08-26:** added a nullable `prescriptionId` (no DB-level FK, same raw-lookup-only convention as `admissionId` on this table); `createAdministration` validates it exists when supplied. Nullable because not every MAR line traces back to a formal prescription (e.g. a nurse-initiated PRN intervention) — the finding's "nothing ties a dose to what authorized it" is closed for the common case without forcing every line through a prescription that may not exist in this codebase's actual workflow.
- [x] **P3** — Tasks/MAR lines creatable against a discharged admission. (`nursing.service.ts:234-239`) — **Fixed 2026-08-26:** `assertAdmissionExists` (the one choke point both `createTask` and `createAdministration` already go through) now also rejects a `Discharged` admission with a 409.

### maternity
- [ ] **P2** — Same stripped-pagination bug as nursing — records list pinned to page 1. (`maternity/dto/maternity.dto.ts:76-84`)
- [ ] **P3** — Nothing prevents multiple maternity records per admission. (`maternity/maternity.service.ts:67-88`)

### vaccination
- [ ] **P2** — No duplicate-dose protection — no check, no unique index. (`vaccination/vaccination.service.ts:40-72`)
- [ ] **P3** — Vaccine name is free text matched by exact equality, no catalog. (`vaccination.service.ts:82-84`)
- [ ] **P3** — A future `administeredDate` is accepted. (`vaccination.service.ts:50-52`)

### ot
- [ ] **P2** — No OT-room double-booking check at all — no conflict query, no unique index, no duration model. (`ot/ot.service.ts:43-93`)
- [ ] **P2** — `start/complete/cancelSurgery` accept and discard an actor parameter — only `scheduledBy` is ever recorded. (`ot.service.ts:122,139,156`)
- [ ] **P3** — No cancellation reason and no post-op notes capture. (`ot.service.ts:156-169`)

### patient-portal
- [ ] **P2** — Three of four list endpoints leak raw internal entities to the patient (staff account IDs, internal free-text notes). (`patient-portal/patient-portal.service.ts:18-31,57-91`)
- [ ] **P2** — Deactivated patients retain full portal access — no `isActive` filter anywhere. (`patient-portal.service.ts:60`)
- [ ] **P2** — Every portal read is unbounded; `listResults()` does 5 sequential unpaginated round trips per patient. (`patient-portal.service.ts:101-175`)
- [ ] **P3** — No `Cache-Control: no-store` on PHI responses. (`patient-portal.controller.ts:10-33`)

### cross-cutting (clinical group)
- [ ] **P2** — Almost none of these modules index the columns they filter on (admissions/appointments/clinical/triage/nursing/maternity/ot/vaccination patient & status columns). (migrations `0009,0011,0012,0014,0030,0037,0038,0039,0047`)
- [ ] **P2** — Module-boundary lint tags stop at the original 11 domains — nursing/maternity/vaccination/ot/patient-portal untagged and invisible to boundary checks; patient-portal already imports entities from six domains with no sanctioned edge. (`eslint.config.mjs:61-80`)
- [ ] **P3** — RBAC seed drift from PRD §6.1 — Nurse holds `order.manage` (should be read-only) and `patients.create/update` (PRD grants neither). (`rbac/seed-rbac-catalog.ts:449-451,498`)
- [ ] **P3** — Actor columns are `uuid NOT NULL` where audit columns were deliberately made `varchar` for the same reason. (`clinical/triage/entities/triage-entry.entity.ts:51-52`, `nursing/entities/nursing.entity.ts:32-33,67-68`)

---

## Diagnostics & Supply Chain

### orders
- [x] **P1** — A cancelled order item can be resurrected to Completed and billed — `completeItemInTransaction` only blocks already-Completed items, not Cancelled ones, and Lab/Radiology `verify()` don't re-check status before calling it. (`orders/orders.service.ts:157`, `lab/lab-workflow.service.ts:257`, `radiology/radiology-workflow.service.ts:228`, `billing/charge-capture.subscriber.ts:41`) — **Fixed 2026-08-25:** `completeItemInTransaction`'s no-op guard changed from `status === 'Completed'` to `status !== 'Pending'`, so a Cancelled item is left untouched (and never fires the Completed-transition charge-capture subscriber) instead of being flipped to Completed. Root-cause fix at the single choke point every workflow module completes through, rather than patching each caller.
- [ ] **P2** — Cancelling an order item leaves its downstream requisition/dispensing live — no cascade. (`orders.service.ts:167-182`)
- [ ] **P2** — `completeItem`/`cancelItem` take no row lock, unlike every other status mutator in the codebase. (`orders.service.ts:128,170`)
- [ ] **P3** — `itemType` is unconstrained free text — a typo silently orphans an unbillable order line. (`dto/create-order.dto.ts:6`)

### lab
- [x] **P1** — Lab result entry/overwrite produces no audit trail — raw `INSERT...ON CONFLICT DO UPDATE` bypasses the audit subscriber entirely. (`lab/lab-workflow.service.ts:191-206`, `libs/audit-emitter/src/lib/audit.subscriber.ts:30-56`) — **Fixed 2026-08-25:** `enterResult` now does find-then-`repository.save()` instead of a raw upsert, so `AuditSubscriber`'s `afterInsert`/`afterUpdate` fire naturally (the existing `pessimistic_write` lock on the requisition already serializes concurrent calls, so no race window). Added a module-bootstrap spec (`lab-audit-wiring.integration-spec.ts`) proving both a create and an overwrite actually publish audit events, plus a plain overwrite-semantics regression test.
- [ ] **P2** — `isAbnormal` is entirely operator-supplied — reference ranges are never evaluated. (`lab-workflow.service.ts:203`, `entities/lab-test-component.entity.ts:19-22`)
- [ ] **P2** — The status machine is untested in this patient-safety-critical module (no test for out-of-order transitions, overwrite path, post-Verified edits). (`lab-workflow.service.integration-spec.ts:17-172`)
- [ ] **P2** — No lab worklist endpoint — technician must already know the order item id. (`lab-workflow.service.ts:131`, `lab-workflow.controller.ts:33-37`)
- [ ] **P3** — A bare `23505` catch mislabels a requisition-number collision as a duplicate order item. (`lab-workflow.service.ts:110`)
- [ ] **P3** — `lab_tests.code` has no UNIQUE constraint; deactivated categories still accept new tests. (`migrations/0018-create-lab-tables.ts:21`)
- [ ] **P3** — Report PDF rendering raw-SQL-joins across bounded contexts, bypassing the cross-domain-join lint rule. (`lab-workflow.service.ts:300-306`)

### radiology
- [ ] **P2** — `verify()` doesn't re-check the order item's status before completing it (same root cause as orders P1). (`radiology/radiology-workflow.service.ts:228`)
- [ ] **P3** — `listByOrderItem` is dead code. (`radiology-workflow.service.ts:129-133`)

### pharmacy
- [x] **P1** — FEFO dispensing preferentially hands out expired stock — no `expiryDate >= today` predicate, no quarantine state, no write-off path. (`inventory/fefo-stock-decrement.service.ts:27-36`, `pharmacy/pharmacy-dispensing.service.ts:195`) — **Fixed 2026-08-25:** the shared FEFO decrement query now excludes any batch with `expiryDate < CURRENT_DATE` (a null expiry is still eligible), so expired stock is never selected — insufficient-stock now correctly fires rather than substituting expired stock. Quarantine/write-off workflows remain a separate, larger feature (not part of this P1). Added a dedicated `FefoStockDecrementService` spec, and fixed several pharmacy/inventory test fixtures whose hardcoded 2025 "future" expiry dates had since drifted into the past.
- [ ] **P2** — No reversal path once stock is dispensed. (`pharmacy-dispensing.service.ts:143-160`)
- [ ] **P2** — RBAC gaps vs PRD §6.1 — Hospital Admin lacks `pharmacy.read`; Pharmacist lacks `inventory.read`/`order.read`. (`rbac/seed-rbac-catalog.ts:545-551`)
- [ ] **P3** — `listByOrderItem` is dead code. (`pharmacy-dispensing.service.ts:119-123`)

### inventory
- [ ] **P2** — `expiryDate` validated as an arbitrary string, never range-checked — feeds directly into the FEFO bug above. (`inventory/dto/record-goods-receipt.dto.ts:7-9`)
- [ ] **P2** — Goods-receipt correctness has no test coverage (over-receipt, atomic stock increment, PO rollup). (`inventory-procurement.service.integration-spec.ts:12-131`)
- [ ] **P2** — `reorderLevel`/`minimumStock` stored but never queried — no low-stock report or reorder alert. (`migrations/0022-create-inventory-tables.ts:36-37`)
- [ ] **P2** — `inventory_items.code` has no UNIQUE constraint. (`migrations/0022-create-inventory-tables.ts:34`)
- [ ] **P3** — No `CHECK (availableQuantity >= 0)` on `stock_balances`. (`migrations/0022-create-inventory-tables.ts:114-123`)

### ward-supply
- [ ] **P2** — `receiveStock` validates the item but never the department. (`ward-supply/ward-supply.service.ts:64-80`)
- [ ] **P2** — Ward stock has no batch or expiry dimension — untraceable once stock leaves the central store. (`entities/ward-stock.entity.ts:15-35`)
- [ ] **P3** — `patientId`/`admissionId` on a consumption recorded without validation. (`ward-supply.service.ts:142-143`)
- [ ] **P3** — Only Receive and Consume exist — no Return/Adjust/Wastage. (`entities/ward-stock.entity.ts:37`)
- [ ] **P3** — `listBalances` is unpaginated while `listTransactions` is paginated. (`ward-supply.service.ts:154-161`)
- [ ] **P3** — Inventory/Store Manager holds no `ward-supply.*` permission despite PRD §6.1 scoping. (`rbac/seed-rbac-catalog.ts:570-575`)

### cssd
- [ ] **P2** — `cssd_instruments.code` has no UNIQUE constraint or duplicate check. (`migrations/0040-create-cssd-tables.ts:9-19`)
- [ ] **P2** — Nothing prevents concurrent InProgress cycles for the same instrument. (`cssd/cssd.service.ts:150-179`)
- [ ] **P2** — No index on the cycles table's `instrumentId`, despite being the list filter. (`migrations/0040-create-cssd-tables.ts:20-34`)
- [ ] **P3** — `sterileExpiryAt` is written but never read. (`cssd.service.ts:200`)
- [ ] **P3** — `reactivateInstrument` doesn't conflict-check, unlike deactivate. (`cssd.service.ts:136-146`)

### ssu
- [ ] **P2** — `subsidyPercent` is validated but applied to nothing — Billing has no idea the case exists. (`ssu/ssu.service.ts:72`)
- [ ] **P2** — The same actor can open and approve a subsidy case — no maker/checker split on a revenue write-off. (`ssu.service.ts:108-124`)
- [ ] **P3** — `closeCase` records no `closedBy`/`closedAt`. (`ssu.service.ts:153-166`)
- [ ] **P3** — Unlimited concurrent Open cases per patient. (`ssu.service.ts:50-81`)

### fraction
- [x] **P1** — `baseAmount` is client-supplied and never reconciled against the invoice — any `fraction.manage` holder can mint an arbitrary doctor payout. (`fraction/fraction.service.ts:118-121,123-126,153`) — **Fixed 2026-08-25:** `baseAmount` removed from the client-facing input entirely; `recordEntry` now resolves it server-side from the invoice's own `totalAmount`, the same way `InvoicesService.captureChargeForOrderItem` resolves price server-side instead of trusting the caller.
- [x] **P1** — `recordEntry` has no idempotency and no unique constraint — a double-submit pays a doctor twice, invisibly. (`fraction.service.ts:155-164`, `entities/fraction.entity.ts:37-63`) — **Fixed 2026-08-25:** added `UQ_fraction_entries_invoice_doctor` (migration 0063) plus an in-transaction pre-check, so at most one entry can exist per (invoice, doctor); a concurrent duplicate maps the constraint violation to 409 instead of a raw 500.
- [ ] **P2** — The default-rule lookup is nondeterministic when a doctor has >1 active null-department rule. (`fraction.service.ts:51-73,144-146`)
- [ ] **P2** — No reversal when the source invoice is returned or cancelled. (`fraction.service.ts:155`)
- [ ] **P3** — Write access sits with Billing/Accounts Staff; PRD places this under HR/Payroll Admin, which has zero grants. (`rbac/seed-rbac-catalog.ts:617-622`)

### cross-cutting (supply-chain group)
- [ ] **P3** — Stale comments in three modules claim charge capture "isn't wired yet" — it has been since §27, understating the orders-P1 blast radius. (`lab-workflow.service.ts:255-256`, `radiology-workflow.service.ts:226-227`, `pharmacy-dispensing.service.ts:209-210`)

---

## Financial & Billing

### billing
- [x] **P1** — A charge captured after a return silently reverses that return — `createReturn` reduces `totalAmount` without touching `subtotal`; the next capture recomputes `totalAmount` from scratch, re-inflating it. (`billing/invoices.service.ts:347-348,584-586`) — **Fixed 2026-08-25:** `createReturn` now also reduces `subtotal`/`taxableAmount` by the return amount, keeping them in lockstep with `totalAmount` so a later capture's recompute can't erase the return. Full per-line GST-split reversal (cgst/sgst) remains a separate, larger gap (tracked as its own P2).
- [x] **P1** — `taxableAmount` is never updated by charge capture — every auto-generated invoice reports ₹0 taxable value. (`invoices.service.ts:347-348,406`) — **Fixed 2026-08-25:** `captureChargeForOrderItem` now adds `unitPrice` to `taxableAmount` alongside `subtotal` (captured lines carry 0 tax, so the two move together).
- [x] **P1** — Cancelling an invoice doesn't reverse its revenue/AR journal — no contra entry posted. (`invoices.service.ts:450-469`) — **Fixed 2026-08-25:** `cancel()` now sums the `invoice_items` with a non-null `sourceOrderItemId` (exactly what charge-capture journaled, and — since `cancel()` already requires `paidAmount === 0` — undisturbed by any return) and posts a reversal journal for that amount; manually-created lines, which never posted a journal, are correctly excluded.
- [x] **P1** — `DepositsService.refund` takes no row lock, unlike `recordPayment` — concurrent refunds can pay out more cash than the deposit held. (`billing/deposits.service.ts:106`) — **Fixed 2026-08-25:** added `pessimistic_write` lock on the deposit lookup, matching `recordPayment`'s invoice lookup.
- [x] **P2** — A repeated same-amount refund decrements cash twice but books one journal (auto-journal treats the re-post as a safe no-op). (`deposits.service.ts:113-134`) — **Fixed 2026-08-26:** `refund()` now checks for an existing `DepositRefund` journal *before* mutating balance, mirroring `AccountingService.postAutoJournal`'s own `(sourceType, sourceId)` + line-match logic instead of relying on it after the fact — a same-amount retry is now a true no-op (no balance mutation, deposit returned unchanged) and a different-amount collision throws `ConflictException` before any mutation.
- [x] **P2** — Charge capture recomputes status from a stale in-memory `paidAmount` with no row lock on the invoice. (`invoices.service.ts:274,325-355`) — **Fixed 2026-08-26:** added `lock: { mode: 'pessimistic_write' }` to `captureChargeForOrderItem`'s open-invoice lookup, matching `recordPayment`/`createReturn`/`cancel`'s existing row lock on the same table.
- [x] **P2** — `taxPercent`/`discountAmount` are unbounded and unsigned. (`dto/create-invoice.dto.ts:25-31`) — **Fixed 2026-08-26:** added `@Min(0)` to `discountAmount` and `@Min(0)`/`@Max(100)` to `taxPercent` on `CreateInvoiceItemDto`.
- [ ] **P2** — Returns never reverse the GST split (`subtotal`/`taxableAmount`/`taxAmount`/cgst/sgst untouched). (`invoices.service.ts:584-587`)
- [ ] **P2** — Charge capture hardcodes 0% tax on every auto-captured line. (`invoices.service.ts:340-343`)
- [x] **P2** — Only one billing permission exists for both reads and writes (`billing.manage`) — front desk can issue refunds, auditors can't view invoices. (`billing/invoices.controller.ts:16-56`) — **Fixed 2026-08-26:** added a `billing.read` permission (mirroring `accounting.read`/`accounting.manage`), applied to the GET endpoints on both `InvoicesController` and `DepositsController`; granted to every existing `billing.manage` role plus, read-only, to Auditor/Compliance.
- [x] **P2** — GSTIN and state code accepted as free-form strings, no format validation. (`dto/update-billing-settings.dto.ts:1-12`) — **Fixed 2026-08-26:** added `@Matches` format validation to `UpdateBillingSettingsDto` (15-character GSTIN pattern; 2-digit state code).
- [ ] **P3** — India GST model is CGST/SGST-only — no IGST/place-of-supply/HSN; inter-state supply can't be invoiced correctly (live Phase-1 gap). (`invoices.service.ts:156-157`)

### accounting
- [x] **P1** — `postAutoJournal` opens a second pooled connection while the caller's own transaction is still open — risks a full pool deadlock under concurrent payments. (`accounting/accounting.service.ts:311`, `database/sequence-number-generator.service.ts:22`) — **Fixed 2026-08-25:** `postAutoJournal` now generates its journal number against the caller's own manager (a new `generateJournalNumberInTransaction` helper querying `journal_sequences` directly), the same pattern `InvoicesService.generateInvoiceNumber` already uses, instead of going through `JournalNumberGeneratorService` (which opens its own connection/transaction). `createJournal`'s own generator call stays as-is since it already runs before opening a transaction, matching the safe convention.
- [x] **P1** — Manual journals never validate `accountId` exists; the trial balance silently drops orphaned lines instead of erroring. (`accounting.service.ts:397-427,456-470`) — **Fixed 2026-08-25:** the missing/inactive-account check from `postAutoJournal` is now shared (`assertAccountsUsable`) and applied to `createJournal` too.
- [ ] **P2** — An account's type can be changed and the system accounts are freely editable after journals are posted. (`accounting.service.ts:140-144,161-174`)
- [ ] **P2** — Report aggregation casts money to `float8` before rounding. (`accounting.service.ts:443-445`)
- [ ] **P2** — Journals list is permanently pinned to page 1 (missing pagination base DTO). (`dto/accounting.dto.ts:75-87`)
- [ ] **P2** — `postJournal` is not row-locked. (`accounting.service.ts:234`)
- [ ] **P3** — `entryDate` validated as a plain string, not a date. (`dto/accounting.dto.ts:62-63`)
- [ ] **P3** — `ledger_accounts.accountCode` has no unique constraint.
- [ ] **P3** — Trial-balance SQL bypasses the soft-delete filter the repository-based reads apply. (`accounting.service.ts:446-451`)

### insurance
- [x] **P1** — Nothing caps total claims against an invoice or a policy's `sumInsured`. (`insurance/insurance-claims.service.ts:302-342,390-414`) — **Fixed 2026-08-26:** `createClaim` now sums non-Rejected claims against the invoice (row locked `FOR UPDATE`) and rejects one that would exceed the invoice's `totalAmount`; `approveClaim` now sums Approved/Paid claims against the policy (row pessimistic-locked) and rejects an approval that would exceed `sumInsured`.
- [ ] **P2** — `updatePolicy` is unusable without resending `policyNumber` (validator requires it even on partial update); no test exists. (`insurance-claims.service.ts:229,455-468`)
- [ ] **P2** — `submitClaim` stamps `processedBy`/`processedAt` before any adjudication happens. (`insurance-claims.service.ts:384-385`)
- [ ] **P2** — Claims list is permanently pinned to page 1 (missing pagination base DTO). (`dto/insurance.dto.ts:158-166`)
- [ ] **P2** — `markClaimPaid` moves no money — no journal, no payment record; insurer-settled invoice stays Unpaid. (`insurance-claims.service.ts:438-453`)
- [ ] **P3** — `checkCoverage` ignores payer deactivation. (`insurance-claims.service.ts:284-296`)
- [ ] **P3** — No uniqueness on patient/payer/policy-number; coverage can change after claims are approved against it. (`entities/patient-policy.entity.ts:16-52`)

### platform-billing
- [ ] **P2** — "Monthly"/"annual" are fixed-millisecond arithmetic — drifts against real calendar months/years. (`platform-billing/subscription-billing.service.ts:14-17,93-94`)
- [ ] **P2** — The vendor's own subscription invoices have no invoice number, tax, or GST fields. (`migrations/0051-create-subscription-billing.ts:24-35`)
- [ ] **P3** — A mid-period package upgrade reprices without proration. (`subscription-billing.service.ts:91-98`)
- [ ] **P3** — "One invoice per period" only enforced for open invoices. (`subscription-billing.service.ts:134-140`)

### payroll
- [ ] **P2** — `deductionPercent` has no upper bound — can produce a negative net with no CHECK constraint. (`payroll/payroll.service.ts:67-69,88-89`)
- [ ] **P2** — A concurrent payroll run aborts the whole run, not just the duplicate. (`payroll.service.ts:72-110`)
- [ ] **P2** — Payroll posts nothing to the ledger. (`payroll.service.ts:114-129`)
- [ ] **P3** — Eligible-employee query ignores soft-deletion. (`payroll.service.ts:73-75`)
- [ ] **P3** — N+1 query in the payroll run loop. (`payroll.service.ts:79-84`)

### fixed-assets
- [ ] **P2** — Back-filling an earlier depreciation period silently books ₹0 (prior-entry lookup finds highest period overall, not highest-before-this-one). (`fixed-assets/fixed-assets.service.ts:273-289`)
- [ ] **P2** — `updateAsset` can change cost/date/useful-life after depreciation entries already exist, with no re-statement. (`fixed-assets.service.ts:327-365`)
- [ ] **P2** — Depreciation accrual posts nothing to the ledger. (`fixed-assets.service.ts:290-302`)
- [ ] **P3** — `salvageValue` isn't validated against `purchaseCost`. (`fixed-assets.service.ts:86,173-175`)
- [ ] **P3** — `resolveActor()` has no fallback parameter, unlike the sibling-module convention. (`fixed-assets.service.ts:118-120`)

### accounts
- [ ] **P2** — Admin-supplied passwords bypass the 8-character minimum (`createStaffAccount`/`resetPassword` only check non-empty). (`accounts/accounts.service.ts:134-142,274,303,446-452`)
- [ ] **P2** — Failed-login counting is a read-modify-write with no lock — undercounts under concurrent brute-force. (`accounts.service.ts:326-336`)
- [ ] **P3** — Duplicate staff usernames 500 instead of 409, unlike the identical check for patient accounts. (`accounts.service.ts:144-162,197-207`)
- [ ] **P3** — Deactivating an already-deactivated account isn't rejected, unlike the catalog-service convention. (`accounts.service.ts:402-424`)

### cross-cutting (financial group)
- [ ] **P2** — Test gaps on money-touching paths per this repo's own risk gate (cancel-vs-reversal-journal, capture-after-return, concurrent deposit refunds, `updatePolicy`, claim-cap-vs-invoice, back-filled depreciation, concurrent payroll/accrual runs).
- [ ] **P3** — Module-boundary lint doesn't cover accounting/insurance/payroll/fixed-assets/platform-billing. (`eslint.config.mjs:61-80`)

---

## Platform & Admin

### auth
- [x] **P1** — The rate limiter on login/refresh/change-password is a silent no-op — `@Throttle({default:...})` targets a throttler name that doesn't exist, so login falls back to the loosest limit and the whole API is capped at 20 req/min/IP. (`auth/auth.controller.ts:16,51,66`, `app/app.module.ts:54-58`) — **Fixed 2026-08-26:** collapsed the three named throttlers (`guest`/`authenticated`/`admin` — none ever selected between per caller, so all three stacked on every request and the tightest silently capped the whole API) to a single `default` throttler that `AuthController`'s `@Throttle({ default: {...} })` now actually matches and overrides.
- [x] **P1** — `change-password` is an unauthenticated username-enumeration oracle (distinct error codes for unknown vs. real username, before any credential check). (`auth/auth.service.ts:183-188`) — **Fixed 2026-08-26:** `changeInitialPassword` now verifies the current password before checking `needsPasswordUpdate`, matching `login()`'s existing ordering, so a known username past the must-change state no longer returns a distinguishable response without a correct password.
- [ ] **P2** — Admin-supplied passwords bypass the 8-character minimum — a tenant can be provisioned with a 1-char Hospital Admin password. (`accounts/accounts.service.ts:134-142`, `tenants/dto/provision-tenant.dto.ts:28-31`)
- [ ] **P2** — Lockout counting reads a stale value — concurrent failed logins never trip the 5-attempt lockout. (`auth/auth.service.ts:112-116`)
- [ ] **P3** — No logout or refresh-token revocation — a stolen refresh token is valid for its full 7-day lifetime.
- [ ] **P3** — No maximum length on password fields. (`auth/dto/login.dto.ts:1-20`)

### rbac
- [x] **P1** — `bypassesPermissionChecks` is dead code, and Hospital Admin doesn't actually have the "full access" the seed implies (permission map omits all Lab/Radiology workflow perms, all Pharmacy perms, several Inventory perms). (`rbac/seed-rbac-catalog.ts:19,26,418-645`, `libs/auth-guards/src/lib/permission.guard.ts:14-34`) — **Fixed 2026-08-26:** removed `bypassesPermissionChecks` entirely (column dropped via migration 0064, entity/seed/service/DTO references removed) rather than wiring it up — Super Admin and Hospital Admin's access already came from explicit permission grants seeded alongside the flag, so the flag was never load-bearing even before this. Hospital Admin's seed now also grants the previously-missing Lab/Radiology workflow, Pharmacy, and Inventory permissions.
- [x] **P2** — The dead god-mode flag is settable over HTTP on role updates. (`rbac/dto/update-role.dto.ts:14`) — **Fixed 2026-08-26:** moot — the field no longer exists on `UpdateRoleDto` (see the P1 fix above).
- [ ] **P2** — `PermissionGuard` only reads handler-level metadata — a class-level `@RequirePermission` would be silently ignored (latent trap, none exist today). (`libs/auth-guards/src/lib/permission.guard.ts:15-18`)
- [ ] **P2** — No dedicated `audit.read` permission — audit trail reuses `reporting.read`. (`audit/audit.controller.ts:14`)
- [ ] **P2** — The RBAC seed is create-only (`ON CONFLICT DO NOTHING`) — changing a seeded role/permission in code never reaches an existing database. (`rbac/seed-rbac-catalog.ts:650,655-662`)
- [ ] **P3** — An unmapped permission prefix fails closed with no signal — silently strips a permission from every tenant's JWT. (`packages/package-catalog.ts:129-188`)
- [ ] **P3** — Cross-tenant role visibility isn't filtered on the hospital branch (blocked at assignment, so UI defect not escalation). (`accounts/accounts.service.ts:381-387`)
- [ ] **P3** — Concurrent duplicate role creation races to a raw 500 instead of 409. (`rbac/role-management.service.ts:30-35`)

### tenants
- [x] **P1** — `provisionTenant`'s failure cleanup can delete another request's tenant under a concurrent provisioning race. (`tenants/tenants.service.ts:100-103,209-215`) — **Fixed 2026-08-26:** the actual mechanism was worse than a delete — `repository.save()` on hospitalId's manually-assigned primary key silently UPDATEd the winner's row in place instead of erroring, so the loser's cleanup then deleted the row it had just corrupted. Replaced with a raw `INSERT` (no `ON CONFLICT`) so the PK constraint rejects a concurrent duplicate with a real error, mapped to the same 409 the existence check already returns; cleanup now only runs when this call's own insert is the one that succeeded.
- [ ] **P2** — Provisioning retry isn't idempotent past the bootstrap admin — a failure after that insert leaves the tenant unretryable without manual DB surgery. (`tenants.service.ts:204-215,221-243`)
- [ ] **P2** — A purged tenant can be restored into a broken "active" state (suspend/reactivate/archive/restore don't check current status). (`tenants.service.ts:439,457,516,527`)
- [ ] **P2** — Deactivated catalog roles can still be enabled for a tenant. (`tenants.service.ts:119-123,290`)
- [ ] **P3** — UUID fields validated as plain strings turn FK violations into 500s. (`tenants/dto/provision-tenant.dto.ts:21-22,38-46`)
- [ ] **P3** — `purgeTenant`'s `DROP ROLE` runs inside the registry transaction — a lingering session can block and roll back the whole purge. (`tenants.service.ts:578-597`)

### master-data
- [ ] **P2** — Every GET endpoint has no permission guard, including for patient-portal accounts — a patient can enumerate the hospital's department/ward/bed layout; no `master-data.read` permission exists. (`master-data/master-data.controller.ts:33,38,66,71,99,104`)
- [ ] **P3** — `reactivateDepartment` doesn't check the parent is active, unlike deactivate's child-check. (`master-data.service.ts:90-100`)
- [ ] **P3** — `deactivateWard` has no occupied-bed guard, unlike `deactivateBed`. (`master-data.service.ts:132-145`)
- [ ] **P3** — Department/ward/bed creation races to a raw 500 instead of 409. (`master-data.service.ts:37,105,167`)

### platform-branding
- [ ] **P2** — `GET /branding` is an unauthenticated tenant-enumeration oracle (excluded from auth middleware, resolves tenant from a caller-controlled header). (`platform-branding/tenant-branding.controller.ts:26-29`, `libs/tenant-context/src/lib/unauthenticated-routes.ts:36`)
- [ ] **P3** — Logo upload runs the object-store call inside the DB transaction holding the advisory lock. (`platform-branding.service.ts:165-172`)

### notifications
- [x] **P1** — Recipient identifier mismatch likely means the feature delivers nothing — subscriber writes `doctorId` as `recipientAccountId`, but reads filter by JWT `accountId`. (`notifications/notifications.subscriber.ts:21,32`, `notifications.controller.ts:17,23,29,35`) — **Fixed 2026-08-26:** `admittingDoctorId`/`doctorId` are unvalidated client input with no FK to `accounts` anywhere in the schema (and `admissions`/`appointments` are module-boundary-blocked from importing the `accounts` domain to check it themselves), so nothing ever guaranteed the two identifier spaces actually lined up — a bad id silently persisted a notification no JWT-authenticated read could ever match. `NotificationsService.create()` (the single choke point every producer goes through) now looks up the recipient account within the same tenant-scoped transaction and returns `null` — logging why — instead of inserting when the account doesn't exist or is deactivated, turning a permanently-unreachable row into an observable, correctly-attributed drop. Fixed test fixtures in both notification specs that previously asserted against bare UUIDs with no backing account row.
- [ ] **P2** — The permission gate on this controller is decorative — mapped permission prefix has no catalog entry. (`packages/package-catalog.ts:142`, `notifications.controller.ts:8`)
- [ ] **P3** — Index shape doesn't match query shape, and there's no retention path. (`migrations/0028-create-notifications-table.ts:22`)

### helpdesk
- [ ] **P2** — Ordinary staff cannot raise a ticket — `POST` requires `helpdesk.manage`, seeded only to admins/agents. (`helpdesk/helpdesk.controller.ts:16`)
- [ ] **P3** — `assignTicket` never validates the assignee exists or is active. (`helpdesk.service.ts:82-98`)
- [ ] **P3** — No index on `status`/`assigneeAccountId`/`createdAt`. (`migrations/0044-create-helpdesk-tables.ts:9-25`)

### marketing
- [ ] **P3** — Referral sources have no uniqueness at any layer. (`marketing/marketing.service.ts:59-76`)
- [ ] **P3** — Write-path ids validated as strings while the read path uses UUID checks. (`dto/marketing.dto.ts:25,28,47-53`)
- [ ] **P3** — Front desk can't record a referral, despite capturing it at registration. (`rbac/seed-rbac-catalog.ts:629-632`)

### reporting
- [ ] **P2** — The revenue dashboard double-counts deposit-funded payments and ignores refunds. (`reporting/reporting-query.service.ts:32,92-115`)
- [ ] **P2** — Reporting hand-rolls a second, divergent pagination contract. (`reporting.controller.ts:14-30`)
- [ ] **P3** — Date-range filters are unvalidated strings across all five endpoints. (`reporting-query.service.ts:51-56,76-81,102-107`)
- [ ] **P3** — CSV export materializes up to 10,000 rows in memory with no streaming. (`reporting-query.service.ts:129-133`)

### audit
- [ ] **P2** — `audit_records` has no indexes whatsoever. (`migrations/0006-create-audit-records-table.ts:7-18`)
- [ ] **P2** — Gated by `reporting.read` instead of its own permission. (`audit/audit.controller.ts:14`)
- [ ] **P3** — Read access to PHI is never audited (only insert/update/remove are tracked).

### packages
- [ ] **P2** — Two sources of truth for a package's module list (DB row vs. in-code catalog) — code changes don't change actual gating until a migration lands. (`packages/packages.service.ts:72`, `packages/package-catalog.ts:49-121`)
- [ ] **P3** — Permission filtering fails open on a missing tenant/package row — grants the full permission set instead of the purchased tier. (`packages.service.ts:69-71`)

### employee
- [ ] **P2** — Employee list is permanently capped at 20 rows (missing pagination base DTO). (`employee/dto/employee.dto.ts:82`)
- [ ] **P3** — `departmentId` validated as a string on write but UUID on read — write path 500s on a bad FK. (`employee/dto/employee.dto.ts:11-13,54-55,83-85`)
- [ ] **P3** — No email format check and no unique constraint on email or phone. (`employee/dto/employee.dto.ts:23-25`)

### database
- [ ] **P2** — The DB password has no production guard, unlike the JWT secret. (`database/data-source.ts:93`, `auth/jwt-secret.ts:8-10`)
- [ ] **P2** — The connection-pool monitor is dead code holding an uncleared timer. (`database/data-source.ts:114-142`)
- [ ] **P3** — Migration ordering is carried entirely by one array, independent of filename/class-name timestamps. (`database/migrations/index.ts:65-135`)
- [ ] **P3** — Secondary indexes missing across the board on newer tenant tables (`audit_records`, `helpdesk_tickets`, `patient_referrals`, `employees`, `notifications`).

### cross-cutting (platform group)
- [ ] **P3** — String-typed fields against `uuid` columns recur across tenants/master-data/marketing/employee/helpdesk — each turns a 400 into a raw 500.
- [ ] **P3** — The throttler misconfiguration (auth, above) is the single highest-impact fix in this set — it both weakens brute-force protection and caps the whole API's throughput.
