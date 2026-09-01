# Technical Design Review Comments

Review target: `new/docs/technical-design/`

## Findings

### High: Authorization and tenant selection are documented as JWT-backed, but current code trusts request headers

**Resolved:** `AuthContextMiddleware` now verifies `Authorization: Bearer <token>` on every route except `/auth/login`/`/auth/refresh`; see `new/docs/superpowers/plans/2026-08-03-jwt-request-authentication.md`.

The PRD says tenant resolution comes from the `hospitalId` JWT claim and that the application guard validates JWTs before checking permissions:

- `new/docs/technical-design/PRD.md:52`
- `new/docs/technical-design/PRD.md:173`

Current implementation reads tenant and permissions directly from client-controlled headers:

- `new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts:11`
- `new/code/libs/auth-guards/src/lib/permission.guard.ts:24`
- `new/code/libs/auth-guards/src/lib/request-context.ts:21`

This overstates the current security model. Either implement JWT validation on protected routes and derive tenant/permissions from verified claims, or mark the docs as target-state and explicitly call out the temporary header-backed guard.

### High: Tenant isolation is described as Postgres role-enforced, but implementation uses one DB user plus search_path

**Resolved:** per-tenant `NOLOGIN` Postgres roles + schema grants now exist, with `SET LOCAL ROLE`
inside a real transaction in `TenantConnectionService`. See
`new/docs/superpowers/plans/2026-08-04-database-enforced-tenant-isolation.md`. Note: the dedicated
DB-level cross-tenant proof test (Postgres itself rejecting a cross-schema query under the wrong
role) was deferred at the human partner's request to prioritize a prototype demo — test coverage
for this item is still outstanding. **Closed 2026-08-20:** the proof now lives in
`tenant-connection.service.integration-spec.ts` (`SET LOCAL ROLE` describe): a schema-qualified
read and a write against another tenant's schema both fail with `permission denied for schema`
under the tenant's own role, with a same-schema positive control.

The PRD says tenant schemas are isolated by Postgres role-level schema grants:

- `new/docs/technical-design/PRD.md:240`
- `new/docs/technical-design/PRD.md:316`

Current implementation uses one configured database user and changes `search_path` at runtime:

- `new/code/apps/api/src/database/data-source.ts:49`
- `new/code/apps/api/src/database/data-source.ts:51`
- `new/code/apps/api/src/database/tenant-connection.service.ts:26`

That is materially weaker than the documented guarantee. A bug in tenant resolution can still point the shared connection at another tenant schema. Either add the role/grant model or rewrite the docs to describe the actual guarantee and residual risk.

### High: Module-boundary linting is presented as active enforcement, but lint is not configured or run

**Resolved:** `@nx/enforce-module-boundaries` (Nx project tags) and `eslint-plugin-boundaries`
(domain-folder tags inside `apps/api`) are both wired and running in CI via the `lint` target; see
`new/docs/superpowers/plans/2026-08-04-nx-module-boundary-enforcement.md`.

The docs repeatedly say `@nx/enforce-module-boundaries` is the hard enforcement mechanism:

- `new/docs/technical-design/Development-Standards.md:10`
- `new/docs/technical-design/PRD.md:307`
- `new/docs/technical-design/PRD.md:315`
- `new/docs/technical-design/PRD.md:327`

But the PRD also admits the concrete config does not exist:

- `new/docs/technical-design/PRD.md:373`

And CI explicitly omits lint:

- `new/code/.github/workflows/ci.yml:36`
- `new/code/.github/workflows/ci.yml:37`

Until ESLint/project tags are wired and CI runs the lint target, the docs should not claim boundary enforcement is active.

### High: Deployment guide has commands and environment variables that do not match the repo

**Resolved:** `Deployment-Guide.md` now uses `DB_USERNAME`/`DB_DATABASE`, the real `apps/api/dist`
build output path and `node apps/api/dist/main.js` start command, and an accurate migrations
section (not automatic on startup; platform vs. tenant migrations; the `migrate-tenants` Nx target;
and the known tooling gap that `migrate.ts`/`migrate-tenants.ts` currently can't be invoked outside
Jest). Also notes no production Dockerfile/`docker-compose.yml` exists yet, rather than describing
one that isn't there.

The guide documents `DB_USER` and `DB_NAME`, but the app reads `DB_USERNAME` and `DB_DATABASE`:

- `new/docs/technical-design/Deployment-Guide.md:28`
- `new/docs/technical-design/Deployment-Guide.md:30`
- `new/code/apps/api/src/database/data-source.ts:51`
- `new/code/apps/api/src/database/data-source.ts:53`

It says migrations run automatically on startup, but `main.ts` only starts Nest; migrations are only run by the standalone migration script:

- `new/docs/technical-design/Deployment-Guide.md:65`
- `new/code/apps/api/src/main.ts:11`
- `new/code/apps/api/src/database/migrate.ts:3`

It also points production execution at `dist/apps/api/main.js`, while the current webpack output path is `apps/api/dist/main.js`:

- `new/docs/technical-design/Deployment-Guide.md:46`
- `new/docs/technical-design/Deployment-Guide.md:62`
- `new/code/apps/api/webpack.config.cjs:5`

These are operator-facing instructions and should be corrected before anyone follows the guide.

### Medium: Runbook and testing standards describe a transaction-backed `inTenant()` helper that does not exist

**Resolved (Runbook):** `Runbook.md` §3 now describes the real `inTenant()` behavior —
`TenantContextService.run()`-scoped `AsyncLocalStorage` context over a really-provisioned
schema/role, no rollback wrapper, no `afterTransactionCommit` anywhere in the codebase — and lists
the actual flakiness sources (schema/role collisions and teardown leaks). `Development-Standards.md`
§5 already states this correctly ("there is no transaction-rollback isolation anywhere in this
codebase") — no change needed there.

The runbook and standards say `inTenant()` provisions a schema, runs tests in a rollback sandbox, and interacts with `afterTransactionCommit`:

- `new/docs/technical-design/Runbook.md:32`
- `new/docs/technical-design/Runbook.md:33`
- `new/docs/technical-design/Runbook.md:37`
- `new/docs/technical-design/Runbook.md:40`
- `new/docs/technical-design/Development-Standards.md:30`

Current tests generally define local helpers that only call `TenantContextService.run(...)` and clean schemas manually:

- `new/code/apps/api/src/billing/invoices.service.integration-spec.ts:49`
- `new/code/apps/api/src/patients/patients.service.integration-spec.ts:25`
- `new/code/apps/api/src/accounts/accounts.controller.integration-spec.ts:38`

The docs should either define and introduce the shared helper as real infrastructure, or describe the current pattern accurately.

### Medium: Moved docs contain stale path references

After moving these files into `new/docs/technical-design/`, references such as `docs/superpowers/specs/...` are ambiguous or stale from the new location:

- `new/docs/technical-design/PRD.md:6`
- `new/docs/technical-design/PRD.md:257`
- `new/docs/technical-design/PRD.md:338`
- `new/docs/technical-design/PRD.md:362`

Use repo-root-relative paths consistently, or update relative links to account for the new folder, for example `../superpowers/specs/...`.

**Resolved:** already fixed by the time this pass reached it — every reference in
`backend/docs/technical-design/PRD.md` (lines 8, 259, 307, 340, 364, 374 as of 2026-09-01) already
uses the correct `../superpowers/specs/...` form, and both referenced files
(`2026-07-31-modular-monolith-architecture-design.md`, `2026-07-30-frontend-framework-architecture-design.md`)
exist exactly there under `backend/docs/superpowers/specs/`. No content change needed — this entry
was just never marked resolved after whichever earlier pass fixed the actual links.

### Medium: List endpoints silently return all tenant rows when their filter is omitted

**Resolved:** a shared `requireParam()` helper in `@hospital/pagination` now throws
`BadRequestException` when the filter is omitted on any of the four affected endpoints; see
`new/docs/superpowers/plans/2026-08-09-pagination-required-filters.md`.

`InventoryProcurementService.listByVendor(vendorId: string)`,
`InventoryRequisitionService.listByDepartment(departmentId: string)`,
`LabWorkflowService.listByOrderItem(orderItemId: string)`, and `OrdersService.list(patientId:
string)` all silently returned every row in the tenant (not an empty result, not an error) if
their filter parameter was omitted from the request, because TypeORM's `find({ where: { x:
undefined } })` treats an `undefined` filter value as "omit this WHERE clause entirely," not as
"match nothing":

- `new/code/apps/api/src/inventory/inventory-procurement.service.ts` (`listByVendor`)
- `new/code/apps/api/src/inventory/inventory-requisition.service.ts` (`listByDepartment`)
- `new/code/apps/api/src/lab/lab-workflow.service.ts` (`listByOrderItem`)
- `new/code/apps/api/src/orders/orders.service.ts` (`list`)

Not a privilege-escalation issue (anyone with the relevant `*.read` permission could already list
everything tenant-wide via other means), but a footgun for API correctness.

### Medium: Billing had no way to reverse a paid invoice

**Resolved:** `InvoicesService.createReturn` (`POST /billing/invoices/:id/returns`) now lets
billing staff issue a return against a `Paid`/`PartiallyPaid` invoice; see
`new/docs/superpowers/specs/2026-08-09-billing-return-credit-note-design.md`.

`billing/` had invoice create/list/get/cancel/record-payment and deposit create/list/refund, but
`cancel` only works before any payment lands (`paidAmount > 0` rejects it outright) — there was no
way to record that a billed item was returned or a service reversed *after* the patient paid for
it. The original Billing spec
(`new/docs/superpowers/specs/2026-08-01-billing-design.md:145`) flagged this as deferred future
work, not an oversight.

- `new/code/apps/api/src/billing/invoices.service.ts` (`createReturn`)
- `new/code/apps/api/src/billing/invoices.controller.ts` (`POST :id/returns`)

### Low: createReturn's initial security review found a missing row lock and a NaN-slips-through validation gap, both fixed before commit

**Resolved:** both fixed in the same change that introduced `createReturn` — never shipped
unfixed. `new/code/apps/api/src/billing/invoices.service.ts`'s `createReturn` now takes a
`pessimistic_write` lock on the invoice row (matching `Development-Standards.md` §15/§16's
established pattern) and validates `input.amount` with `Number.isFinite()` before comparing (a
bare `amount <= 0` check silently passes for `undefined`/`NaN`, since that comparison is always
`false`). Recorded here because the same missing-lock gap was found to already exist,
unfixed, in the pre-existing `recordPayment`/`cancel` methods — see `pending-tasks.md`'s
"Dependencies worth calling out explicitly" for that follow-up item.

### High: Module-boundary lint had zero coverage of Lab/Radiology/Pharmacy/Inventory, and they were exploiting exactly the violations it would have caught

**Resolved:** `eslint.config.mjs`'s `boundaries/elements` now tags all four domains (manually applied
by the human partner — `eslint.config.mjs` is protected from agent edits by `guard-config.sh`), with
`lab`/`radiology`/`pharmacy → orders` and `pharmacy → inventory` sanctioned in the allow-list.
Lab/Radiology/Pharmacy's workflow services now route order-item completion through
`OrdersService.completeItemInTransaction()` instead of mutating `OrderItem` via raw repository access,
and no longer depend on Billing at all (see the next finding). See `Development-Standards.md` §23.

`Development-Standards.md` §7 documents the module-boundary system in detail, including a "verified
negative example" proving it blocks an unsanctioned `patients → admissions` import — but Lab,
Radiology, Pharmacy, and Inventory (§14–§18, all added after §7 was written) were never added to the
`boundaries/elements` tag list, so `eslint-plugin-boundaries` had no opinion on anything in those four
directories:

- `new/code/eslint.config.mjs` (`boundaries/elements`, before this fix)
- `new/code/apps/api/src/lab/lab-workflow.service.ts` (`verify()`, direct `OrderItem` repository mutation)
- `new/code/apps/api/src/radiology/radiology-workflow.service.ts` (`verify()`, same pattern)
- `new/code/apps/api/src/pharmacy/pharmacy-dispensing.service.ts` (`dispenseDrug()`, same pattern)

### Medium: A dead, tenant-unsafe `OrderBillingAdapter` and a broken `autoChargeForCompletedOrder` masked that automatic charge-capture was never actually implemented

**Resolved:** `InvoicesService.autoChargeForCompletedOrder()` and the `OrderBillingAdapter` interface
plus its three implementations (`LabBillingAdapter`, `RadiologyBillingAdapter`,
`PharmacyBillingAdapter`) were removed outright. See `Development-Standards.md` §23 and
`pending-tasks.md`'s "Billing: automatic charge-capture" item, which was corrected rather than closed.

`autoChargeForCompletedOrder()` queried `lab_catalog_tests`/`radiology_catalog_items`/
`inventory_catalog_items` and a `price`/`salePrice` column — none of which exist; the real catalog
tables (`lab_tests`, `radiology_imaging_items`, `inventory_items`) have no pricing column at all. Every
call was silently swallowed by the calling workflow service's own `catch (billingError) {
console.error(...) }`, so this had almost certainly never produced a real invoice. Separately, the
never-wired `OrderBillingAdapter` implementations (landed in `c416f0a`, survived that commit's own
revert of unrelated fallout) used a raw `dataSource.createQueryRunner()` with no
`TenantConnectionService.runInTenantSchema()` wrapping — had they ever been wired up, they would have
violated `Development-Standards.md` §2's tenant-isolation boundary:

- `new/code/apps/api/src/billing/invoices.service.ts` (`autoChargeForCompletedOrder`, before removal)
- `new/code/apps/api/src/billing/adapters/order-billing.adapter.ts` (before deletion)
- `new/code/apps/api/src/lab/lab-billing.adapter.ts`, `radiology/radiology-billing.adapter.ts`,
  `pharmacy/pharmacy-billing.adapter.ts` (before deletion)

### High: A malformed migration timestamp broke tenant provisioning for every schema created after Patients

**Resolved:** `database/migrations/0008-create-patient-tables.ts`'s `name` field corrected to
`CreatePatientTables0008_2000000000005`. See `Development-Standards.md` §23 and `pending-tasks.md`'s
"Dependencies worth calling out explicitly" for the full analysis.

The migration's `name` (`CreatePatientTables0008200000000008`) parsed via TypeORM's
`migrationClassName.slice(-13)` to `8200000000008` — sorting it dead last among all 28 tracked
migrations instead of 8th, after every migration with a foreign key on `patients` (Appointments,
Vitals, Orders, Billing, and more). Every freshly-provisioned tenant schema — including every
integration test's — would fail partway through migration with `relation "patients" does not exist`,
which looked exactly like a flaky local Postgres/Docker environment issue until traced to its root
cause:

- `new/code/apps/api/src/database/migrations/0008-create-patient-tables.ts` (`name`, before fix)
- `new/code/apps/api/src/database/migrations/index.ts` (correct array order; irrelevant to execution
  order, since TypeORM sorts by parsed timestamp, not array position or file-number prefix)

### Low: Two duplicated implementations (number generators, FEFO stock decrement) collapsed into shared services

**Resolved:** `database/sequence-number-generator.service.ts` and
`inventory/fefo-stock-decrement.service.ts`. See `Development-Standards.md` §23.

Six near-identical number-generator services (Patients, Lab, Radiology, Pharmacy, Inventory's
purchase-order and stock-requisition sequences) and two identical FEFO locked-batch-walk
implementations (Inventory's `fulfillRequisitionItem`, Pharmacy's `dispenseDrug`) — both examples of
this codebase's documented "mirror-don't-extract" convention (§18) reaching a scale where a shared
implementation paid for itself, particularly for the FEFO logic given its locking/tuple-shape
correctness history (§17). Both extractions preserve every existing call site's public surface — the
number-generator wrappers keep their original class/method names and constructor signatures entirely;
the FEFO extraction required updating both callers' constructors (and their integration specs' manual
construction) since the shared service needs the caller's own transaction `manager` passed in.

### Medium: The reporting "SQL-level failure" test was asserting only one of two legitimate Postgres failure modes, and the global RBAC catalog can carry stale seed mappings

**Resolved (2026-08-20):** the assertion in
`persisting-reporting-event-publisher.integration-spec.ts` now accepts both 42P01
(`relation "reporting_events" does not exist`) and 42501 (`permission denied for table
reporting_events`); the business-transaction-commits invariant is unchanged. See
`pending-tasks.md`'s "Dependencies worth calling out explicitly" for the root cause
(`runInTenantSchema`'s `search_path = ("tenant_X", public)` falling through onto a stale
`public.reporting_events` leftover from the pre-tenant-schema era). Also fixed while investigating:
`apps/api/jest.config.cts` `testTimeout` raised from Jest's 5000ms default to 60000 (full-AppModule
suites legitimately need more under parallel workers), the ThrottlerGuard now uses per-app in-memory
storage under `NODE_ENV=test` instead of one shared Redis counter (a full-suite parallel run could
aggregate past the guest/authenticated limits and 429 unrelated suites), stale pagination-shape
assertions in the billing and appointments service specs were aligned to the `{ data, meta }`
contract, and four leftover `Super Admin → patients.*` rows were deleted from the dev DB's global
`role_permissions` (the seed is insert-only, so removing a mapping never propagates to existing
DBs). Verified: full api suite green (`355 passed, 1 skipped — the deferred DB-level isolation proof
test`), typecheck green across all 7 Nx projects.

### High: Domain "actor" fields were client-supplied, so any permissioned caller could attribute an action to an arbitrary user

**Resolved (2026-08-20):** every domain actor field now derives from the authenticated principal
(`TenantContextService.getAccountId()`, set by `TenantContextMiddleware` from the verified JWT) with
the caller-supplied value only as a fallback for non-HTTP callers; DTO fields are optional-but-ignored.
Triage's `broughtBy` deliberately stays client-suppliable (companion, not the logged-in user). 26 new
integration tests pin the override across Lab, Radiology, Pharmacy, Inventory (procurement +
requisition), Billing (invoices + deposits), Orders, Admissions, Triage, and Tenants. See
`Development-Standards.md` §25 and `pending-tasks.md`. **Also found and fixed while auditing the
surface:** the `DischargeSummary` entity was never registered in the DataSource and had no migration,
so every discharge-summary endpoint threw `EntityMetadataNotFoundError` — added registration +
migration `0030` + integration coverage.

### High: Billing had no automatic charge-capture — the dead `autoChargeForCompletedOrder` queried catalog tables that don't exist

**Resolved (2026-08-20):** the pricing data model (`lab_tests.price`,
`radiology_imaging_items.price`, `inventory_items.salePrice`, migration `0031`) plus
`ChargeCaptureSubscriber` + `InvoicesService.captureChargeForOrderItem` now auto-charge a completed
Lab/Radiology/Pharmacy order item onto the patient's open invoice (see `Development-Standards.md`
§27). The earlier half-fix (`autoChargeForCompletedOrder` + dead `OrderBillingAdapter`), removed in
the 2026-08-14 pass, is replaced by a working implementation with 8 integration tests; the
`pending-tasks.md` item is checked off.

## Frontend Review — 2026-08-30 (staff-console, all modules)

Module-by-module review of `frontend/apps/staff-console` for bugs, improvements, and UI/UX gaps (backend/tenant-isolation findings above are unaffected). Six passes, one per module cluster; each pass first swept for known recurrence patterns documented in `frontend/CLAUDE.md`'s "Screen-building conventions" section (missing `.subscribe` error handlers, `route.snapshot.paramMap` reads, `undefined` spread into query params, `p-table` lazy double-fetch, missing `runGuardsAndResolvers: 'always'`, undefined `glass-*`/`gradient-*` utility classes, hand-rolled `HttpClient` bypassing `ApiClientService`) before looking for new issues. Findings below are new (the known-pattern sweep came back clean everywhere except one recurrence, noted in Admin & Platform).

### Module group: registration & clinical encounters (`admissions`, `appointments`, `encounters`, `triage`, `vitals`, `patients`, `orders`)

### High: Patient chart tabs silently show only the first 20 records — and appointments are sorted oldest-first

**Resolved (2026-08-30):** each tab now fetches with an explicit `limit: 200` (`patient-detail.ts`'s `PATIENT_CHART_TAB_LIMIT`). The oldest-first backend sort for appointments is unchanged — that's a backend ordering choice, out of scope for this frontend pass.

`PatientDetail` loads appointments, admissions, orders and invoices with no `page`/`limit`, so the backend's `paginate()` default of `limit: 20` applies (`backend/code/libs/pagination/src/utils/paginate.ts:14`). The component then stores only `result.data` and renders it in a `p-table` with a **client-side** paginator (`[paginator]="true" [rows]="10"`), so the UI confidently reports "1–10 of 20" for a patient who has 60 appointments. Worse, the backend orders appointments `appointmentDate ASC`, so the 20 rows kept are the *oldest* — a long-standing patient's chart shows visits from years ago and hides every recent one, with no truncation indicator anywhere. For a clinical chart this is silent data loss at the point of care, not a cosmetic paging bug.

- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:430`
- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:446`
- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:462`
- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:478`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:114`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:363`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:392`

### High: "Record Vitals" pre-fills the new reading with the previous reading's values

**Resolved (2026-08-30):** product decision made — `openVitalModal()` now only carries forward height/weight; point-in-time measurements and `triageNotes` start blank. `patient-detail.spec.ts`'s pinned test updated to match the new intent.

`openVitalModal()` copies temperature, pulse, BP, respiratory rate, SpO₂, pain score and the previous `triageNotes` from `this.vitals()[0]` into the blank create form. A nurse who opens the dialog to record only a new temperature and presses Save writes a fresh, now-timestamped vitals row asserting a BP and SpO₂ that were never measured — fabricated clinical observations that then drive triage/deterioration decisions and are indistinguishable from real ones. Carry-forward is defensible for height/weight; it is not for point-in-time measurements or free-text notes. Note this behaviour is deliberate and locked in by a test (`patient-detail.spec.ts:255`), so it needs a product decision, not just a code fix — and the sibling standalone Vitals screen does *not* pre-fill (`vital-list.ts:98`), so the two entry points disagree.

- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:257`
- `frontend/apps/staff-console/src/app/patients/patient-detail.spec.ts:255`
- `frontend/apps/staff-console/src/app/vitals/vital-list.ts:93`

### High: Clinical records are deleted/voided on a single click with no confirmation, and several failures are swallowed silently

**Resolved (2026-08-30):** added a shared `ConfirmationService`/`<p-confirmDialog>` (app-wide, mirroring the existing `MessageService`/`<p-toast>` pattern — nothing like it existed before) and wired it into diagnosis/prescription delete and vitals void, in both `patient-detail.ts` and `encounter-list.ts`/`vital-list.ts`; all three now also toast on error.

Deleting a diagnosis or prescription and voiding a vitals record all fire the API call straight from the click handler — no `p-confirmDialog`, no "are you sure", and in three of the five cases no error feedback at all (`error: () => undefined`). One stray click on an icon-only trash button in a dense table permanently removes a diagnosis from a patient's record; if the delete then fails server-side the user sees nothing and assumes it worked, while the row is still there after reload. This is also inconsistent within the same app: `AppointmentDetail.confirmCancel` and `AdmissionDetail.confirmDischarge` both gate their destructive action behind a modal, and `PatientDetail`'s delete handlers at least surface an error toast.

- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:369`
- `frontend/apps/staff-console/src/app/patients/patient-detail.ts:416`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:297`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:342`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.ts:224`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.ts:269`
- `frontend/apps/staff-console/src/app/vitals/vital-list.ts:114`
- `frontend/apps/staff-console/src/app/vitals/vital-list.html:124`

### High: The duplicate-patient guard can itself create duplicate patients (double-submit) and dead-ends on failure

**Resolved (2026-08-30):** `submitRegistration()`'s double-submit guard moved to fire for both call sites; `proceedWithDuplicate()` now guards re-entry and binds `[loading]` on its button; a failed create now resets `showDuplicateWarning` so the user returns to their still-populated form instead of a dead end; `.toPromise()` replaced with `firstValueFrom`.

`proceedWithDuplicate()` calls `submitRegistration()` without setting `isSaving` back to `true`, and the "Register as New Patient Anyway" button has no `[loading]`/`[disabled]` binding — so two fast clicks issue two `POST /patients` calls, both with `allowDuplicate: true`, producing exactly the duplicate MRN the whole flow exists to prevent. Separately, if the create fails from the duplicate panel, `showDuplicateWarning` stays `true`, the panel replaces the form, and the footer `Register` button is disabled by `showDuplicateWarning()` — the user cannot get back to their typed data and must Cancel and re-key the whole registration. The `.toPromise()` on the duplicate check is also deprecated (removed in RxJS 8) and is the only place in these seven modules that doesn't use the codebase's `subscribe({next, error})` convention.

- `frontend/apps/staff-console/src/app/patients/patient-list.ts:210`
- `frontend/apps/staff-console/src/app/patients/patient-list.ts:184`
- `frontend/apps/staff-console/src/app/patients/patient-list.ts:156`
- `frontend/apps/staff-console/src/app/patients/patient-list.html:140`
- `frontend/apps/staff-console/src/app/patients/patient-list.html:272`

### Medium: Admissions "Active" view pagination is fictional — every page shows the whole list

**Resolved (2026-08-30):** `admissions` is now a `computed()` slice over a dedicated `activeAdmissionsAll` signal for the Active view; `onLazyLoad` no longer refetches on a page change in that view, it just re-slices client-side.

The code comment claims "pagination is client-side over that array", but no slicing exists: `listActive()` puts the full array into `admissions` and `data.length` into `totalRecords`, while the `p-table` is in `[lazy]="true"` mode, which renders `value` verbatim without paging it. With 35 active inpatients the table renders all 35 rows at once, the paginator claims 4 pages, and clicking page 2 re-fetches the identical full list and re-renders the same 35 rows — the `first` offset is accepted by `load()` and then ignored on this branch.

- `frontend/apps/staff-console/src/app/admissions/admission-list.ts:76`
- `frontend/apps/staff-console/src/app/admissions/admission-list.ts:90`
- `frontend/apps/staff-console/src/app/admissions/admission-list.html:48`

### Medium: Appointment / order / triage detail screens have no not-found or error state — they hang on "Loading…" forever

**Resolved (2026-08-30):** all three siblings (`appointment-detail.ts`, `order-detail.ts`, `triage-detail.ts`) now match `AdmissionDetail`'s pattern (`notFound` signal + 404 branch + back affordance).

`AdmissionDetail` handles this correctly (`notFound` signal, 404 branch, "Back to Admissions" affordance). Its three siblings don't: on any non-2xx from `getById` they clear `loading` but leave the entity signal `null`, and the templates have no `@else` for that case. The result is a header stuck at "Loading Appointment..." / "Loading Triage Entry..." above a completely blank page, with no message and no way back except the browser.

- `frontend/apps/staff-console/src/app/appointments/appointment-detail.ts:65`
- `frontend/apps/staff-console/src/app/appointments/appointment-detail.html:9`
- `frontend/apps/staff-console/src/app/orders/order-detail.ts:45`
- `frontend/apps/staff-console/src/app/triage/triage-detail.ts:63`
- `frontend/apps/staff-console/src/app/admissions/admission-detail.ts:80`

### Medium: Triage assessment overwrites `triagedAt`/`triagedBy` on every save, destroying the time-to-triage record

**Resolved (2026-08-30):** `saveAssessment()` now only sends `triagedAt`/`triagedBy` when `entry.triagedAt` is not already set (i.e. the first triage transition); later edits (discharge remarks, status changes) no longer touch either field.

`saveAssessment()` unconditionally sends `triagedAt: new Date().toISOString()` and `triagedBy: currentUser().sub` on *every* update, including edits that only change discharge remarks or move the status to "Discharged" hours later. The original triage timestamp — the field an ER uses to measure door-to-triage time and to attribute the acuity assignment — is silently replaced by whoever last touched the form.

- `frontend/apps/staff-console/src/app/triage/triage-detail.ts:76`

### Medium: Orders are a dead end — line items can be created but never completed or cancelled

**Resolved (2026-08-30):** `OrdersApiService` gained `completeItem`/`cancelItem`; `order-detail.ts`/`.html` now render Complete/Cancel actions per pending line item, gated on `order.manage`, with a confirm step for Complete and a mandatory-reason modal for Cancel (mirroring the appointment-cancel pattern).

The backend exposes `PATCH /orders/:id/items/:itemId/complete` and `.../cancel` (`backend/code/apps/api/src/orders/orders.controller.ts:32,38`), but `OrdersApiService` has only `create`/`list`/`getById`, and `order-detail.html` renders the item table read-only with a "Cancel Reason" column that can never be populated from this UI. Every order therefore sits at `Pending` forever. `OrderDetail` also injects no `AuthService` and does no `order.manage` gating.

- `frontend/apps/staff-console/src/app/orders/orders-api.service.ts:65`
- `frontend/apps/staff-console/src/app/orders/order-detail.ts:17`
- `frontend/apps/staff-console/src/app/orders/order-detail.html:76`

### Medium: Encounters screen renders a false "no records" empty state while data is still loading

**Resolved (2026-08-30):** the Notes tab now shows a spinner while `loading()` is true instead of falling into `@empty`; the Diagnoses/Prescriptions `p-table`s now bind `[loading]="loading()"`.

`EncounterList` sets and clears a `loading` signal in `reloadAll()`, but `encounter-list.html` never reads it. Between clicking "Open Encounter" and the three parallel responses landing, the tabs render `@empty` blocks showing "No clinical notes for this patient." etc. — a clinician on a slow link sees an authoritative-looking empty chart for a patient who has records. The sibling Vitals screen binds the same signal correctly.

- `frontend/apps/staff-console/src/app/encounters/encounter-list.ts:107`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.html:127`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.html:179`
- `frontend/apps/staff-console/src/app/vitals/vital-list.html:90`

### Medium: `today()` is computed in UTC, so the appointment day-list is wrong before 05:30 IST

**Resolved (2026-08-30):** added a shared `frontend/apps/staff-console/src/app/shared/date.util.ts` (`todayLocal()`); `appointment-list.ts` now imports it in place of its local UTC-based `today()`. The same pattern in employees/vaccination/maternity/accounting is deferred to those modules' own review groups, which will reuse this helper.

`new Date().toISOString().slice(0, 10)` yields the *UTC* calendar date. In IST (UTC+5:30) every local time from 00:00 to 05:29 resolves to the previous day, so the night-shift front desk opens Appointments and gets yesterday's clinic list as the default filter, and the New Appointment dialog defaults to yesterday's date. The same pattern recurs at `employees/employee-list.ts:20`, `vaccination/vaccination-list.ts:62`, `maternity/maternity-list.ts:97`, `accounting/accounting-console.ts:31,255,312` — a shared `todayLocal()` helper is the right fix workspace-wide.

- `frontend/apps/staff-console/src/app/appointments/appointment-list.ts:16`
- `frontend/apps/staff-console/src/app/appointments/appointment-list.ts:47`
- `frontend/apps/staff-console/src/app/appointments/appointment-list.ts:124`

### Medium: Accessibility gaps — unlabelled form fields, unnamed icon-only buttons, and a tooltip directive that isn't imported

**Resolved (2026-08-30):** added `for`/`id`/`inputId` pairs to every cited field (Vitals dialog, Encounters note/diagnosis/prescription dialogs, Orders line-item rows), `ariaLabel` to every cited icon-only button, and imported `TooltipModule` into `TriageList`.

(1) Every field in the Vitals dialog, the Encounters note/diagnosis/prescription dialogs and the Orders line-item rows uses a bare `<label>` with no `for` and an input with no `id` — the admissions/appointments/triage dialogs in the same app do `for`/`inputId` correctly, so this is inconsistency, not house style. (2) Icon-only `p-button`s (row-navigation chevrons, delete-item trash, back arrows) have no `aria-label`. (3) `triage-list.html:41` uses `pTooltip` but `TooltipModule` is not in the component's `imports`, so the directive never instantiates — the link icon carries no hover text and no accessible name.

- `frontend/apps/staff-console/src/app/vitals/vital-list.html:155`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.html:254`
- `frontend/apps/staff-console/src/app/orders/order-list.html:110`
- `frontend/apps/staff-console/src/app/orders/order-list.html:105`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:133`
- `frontend/apps/staff-console/src/app/triage/triage-list.html:41`
- `frontend/apps/staff-console/src/app/triage/triage-list.ts:20`

### Low: Two divergent copies each of `VitalsApiService` and `EncountersApiService`

**Deferred (2026-08-30):** not fixed in this pass — cosmetic duplication, not a bug, and collapsing the pair requires reconciling divergent method names/nullability across two active consumer sets. Left open for a dedicated follow-up.

`patients/vitals-api.service.ts` and `vitals/vitals-api.service.ts` are competing definitions of the same endpoints with different method names, model shapes and nullability; the same is true of `patients/encounters-api.service.ts` vs `encounters/encounters-api.service.ts`. Both pairs are in active use, so any backend contract change has to be applied twice.

- `frontend/apps/staff-console/src/app/patients/vitals-api.service.ts:42`
- `frontend/apps/staff-console/src/app/vitals/vitals-api.service.ts:37`
- `frontend/apps/staff-console/src/app/patients/encounters-api.service.ts:85`
- `frontend/apps/staff-console/src/app/encounters/encounters-api.service.ts:76`

**Resolved (2026-09-01):** deleted both `patients/`-local copies; `patient-detail.ts` now imports
the canonical service each domain module already owned (`vitals/vitals-api.service.ts`,
`encounters/encounters-api.service.ts`) — matching how it already imported
`AdmissionsApiService`/`OrdersApiService`/etc. from their own folders, making the `patients/`-local
duplicates the actual outlier, not the norm. Reconciled the two divergent shapes field-by-field
against the real backend entities rather than picking one wholesale: `patients/`'s copies had the
fuller field set (`appointmentId`, `updatedAt`, `Prescription.status` — all real, confirmed against
the entities) but wrongly typed nullable columns as non-null-optional; `vitals/`/`encounters/`'s
copies had correct nullable typing (`| null`, matching TypeORM's actual behavior for a nullable
column with no value) but had silently dropped those same real fields. Kept the fuller field set
with the correct nullable typing, standardized on `encounters/`'s optional-`limit` `get*ByPatient`
naming, and kept Vitals' `update`/`voidVital` methods (real, backend-backed, just unused by either
current consumer — confirmed via a full-app grep, not assumed). Moved both services' HTTP-level
spec files to their canonical location, adding coverage for `update`/`voidVital` which had none
before. Verified live: full create→list→void round trip on the standalone Vitals screen, and both
consumers' read paths (patient-detail's tabs, the standalone Encounters screen) with zero
console/network errors. See `Development-Standards.md` §124 for the general pattern.

### Module group: specialty care (`nursing`, `maternity`, `ot`, `ssu`, `cssd`, `vaccination`)

### High: Write actions in nursing, OT, maternity, vaccination and CSSD are never permission-gated

**Resolved (2026-08-30):** each module now reads `auth.hasPermission('<module>.manage')` into a `canManage` flag and gates every mutating control on it (copying SSU's `canManage` + "View only" pattern), including the module-level create/add buttons (New Task, Schedule Surgery, Record Delivery, Record Vaccination, Add Instrument, Start Cycle).

All five routes are guarded only by their `*_READ` permission, yet every mutating control on the screen renders unconditionally — a user holding just `nursing.read` sees Start/Complete/Cancel/Administer/Skip, `ot.read` sees Start/Complete/Cancel Surgery, `cssd.read` sees Deactivate Instrument and Mark Cycle Failed. `NURSING_MANAGE`/`OT_MANAGE`/`MATERNITY_MANAGE`/`VACCINATION_MANAGE`/`CSSD_MANAGE` all exist in `libs/auth/src/lib/permissions.ts`, and SSU already does this correctly (`canManage` gate, plus a "View only" affordance) — so does every sibling outside this review (admissions, triage, vitals, encounters, payroll, employees). Concrete failure: a read-only ward clerk clicks "Cancel" on a scheduled surgery, the backend `PermissionGuard` returns 403, and the user gets a generic "Action failed" toast for a button that should never have been on screen. This is the highest-leverage fix in the whole frontend review — five modules, one established pattern to copy from `ssu-list.ts:109`.

- `frontend/apps/staff-console/src/app/app.routes.ts:88` (and `:93`, `:98`, `:103`, `:108`)
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:33`, `:58`, `:61`, `:62`, `:79`, `:106`, `:107`
- `frontend/apps/staff-console/src/app/ot/ot-list.html:8`, `:73`, `:74`, `:77`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.html:8`, `:66`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.html:8`
- `frontend/apps/staff-console/src/app/cssd/cssd-console.html:18`, `:45`, `:62`, `:89`, `:90`
- correct pattern: `frontend/apps/staff-console/src/app/ssu/ssu-list.ts:109`, `frontend/apps/staff-console/src/app/ssu/ssu-list.html:9`, `:93`

### High: Irreversible clinical transitions fire on a single click with no confirmation step

**Resolved (2026-08-30):** wired the `ConfirmationService` built for the clinical/registration group into Cancel Surgery, Complete Surgery, Cancel Task, Administer Dose, and Deactivate Instrument. Skip Dose now opens a modal that requires a mandatory reason (previously the API accepted a `notes` field the UI never collected — it now does). CSSD's Complete/Fail cycle actions already routed through a two-step modal and needed no change.

Cancel Surgery, Complete Surgery, Cancel Task, Administer Dose, Skip Dose, Mark Cycle Failed and Deactivate Instrument all POST immediately from the row's `(onClick)`. There is no `ConfirmationService`/`p-confirmDialog` anywhere in the app; SSU establishes the house pattern instead — a `p-dialog` naming the record and requiring an explicit second click (and, for reject, a mandatory reason). Two are worse than a mis-click: "Skip" writes a missed-dose entry to the MAR and the API accepts a `notes` reason the UI never collects, so every skipped dose is recorded with a null justification; "Mark Cycle Failed" invalidates a sterilization batch.

- `frontend/apps/staff-console/src/app/ot/ot-list.ts:131` (cancel), `:127` (complete)
- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:108` (cancel task), `:181` (skip)
- `frontend/apps/staff-console/src/app/nursing/nursing-api.service.ts:52` — `notes?` accepted, never passed
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:106-107` (adjacent Administer / Skip)
- `frontend/apps/staff-console/src/app/cssd/cssd-console.ts:117` (deactivate), `frontend/apps/staff-console/src/app/cssd/cssd-console.html:45`
- house pattern: `frontend/apps/staff-console/src/app/ssu/ssu-list.html:280-389`

### High: Recording a maternity delivery is one-shot, unvalidated and unconfirmed

**Resolved (2026-08-30):** `submitDelivery()` now validates delivery date and a baby count ≥ 1 before proceeding (rejecting a cleared/null count instead of posting it), the Save button is disabled until both are valid, and a `ConfirmationService` step ("this cannot be undone") gates the actual submit.

The Record Delivery dialog's Save button carries no `[disabled]` expression at all — unique among the ~10 submit buttons in these six modules. Baby Count comes from a `p-inputNumber` that emits `null` when cleared, and `deliveryForm` is posted verbatim, so a cleared field sends `babyCount: null`. Once `deliveryDate` is set the action disappears from the row and no edit or detail screen exists — a delivery recorded with the wrong type, date or baby count is permanently uncorrectable from this UI.

- `frontend/apps/staff-console/src/app/maternity/maternity-list.html:154` (no `[disabled]`)
- `frontend/apps/staff-console/src/app/maternity/maternity-list.html:144` (`babyCount` can go null), `:65`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.ts:107`

### High: Nursing MAR and CSSD cycle lists silently show only the server's first page

**Resolved (2026-08-30):** both nursing tables now use the standard lazy `p-table` pattern (page/limit params, `totalRecords`, `[paginator]`) copied from OT/maternity; `NursingApiService.listTasks`/`listAdministrations` and `CssdApiService.listCycles`'s call sites now pass page/limit and read `result.meta.total`. While fixing this, found and fixed the same wrong-envelope bug independently latent in OT, maternity, and vaccination: their list-result types declared a flat `{data, total}` instead of the backend's actual `{data, meta: {total, page, limit, totalPages}}`, so `totalRecords` was `undefined` in all three paginators the whole time — the original review's "clean" verdict on their pagination markup didn't catch that the type behind it was wrong. All four model files (`nursing.model.ts`, `ot.model.ts`, `maternity.model.ts`, `vaccination.model.ts`, `cssd.model.ts`) now declare the correct envelope shape.

`NursingApiService.listTasks`/`listAdministrations` send no `page`/`limit`, `CssdApiService.listCycles` is called with no params, and all three responses' `total` field is discarded — the templates use a plain `p-table` with no `[paginator]`, unlike maternity/OT/SSU/vaccination which all paginate properly. A busy ward whose admission has more open tasks or scheduled doses than the backend's default cap will have doses that simply do not appear on the medication administration record, with no hint that rows are missing. Silent truncation of a MAR is a patient-safety-grade omission; CSSD has the same problem for sterilization history.

- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:67`, `:134` (`result.total` dropped)
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:35`, `:81` (no `[paginator]`)
- `frontend/apps/staff-console/src/app/cssd/cssd-console.ts:138`, `:140`
- `frontend/apps/staff-console/src/app/cssd/cssd-console.html:20`, `:64`
- contrast: `frontend/apps/staff-console/src/app/maternity/maternity-list.html:28-40`

### High: Five of the six modules require staff to hand-type a raw patient/admission UUID

**Deferred (2026-08-30):** not fixed in this pass. SSU's picker pattern is the correct fix to copy, but reproducing it across nursing (admission-scoped, needs an admission search, not patient search), OT, maternity, and vaccination is substantial repetitive UI work — 4 modules × search state + picker markup + escape hatch. Scoped as a dedicated follow-up rather than folded into this pass.

Nursing, OT, maternity and vaccination expose the patient/admission as a bare `pInputText` in both the filter bar and the create dialog, and their tables render the same raw UUID back with no patient name anywhere on screen. SSU already solves this with a search-by-name/number picker backed by `PatientsApiService` plus a "or enter Patient ID directly" escape hatch. A transposed UUID that happens to resolve creates a clinical record against the wrong person, and nothing in the UI would reveal it.

- `frontend/apps/staff-console/src/app/ot/ot-list.html:59`, `:102`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:10-17`, `:136`, `:171`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.html:53-54`, `:91`, `:95`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.html:52`, `:79`
- pattern to reuse: `frontend/apps/staff-console/src/app/ssu/ssu-list.ts:162-186`, `frontend/apps/staff-console/src/app/ssu/ssu-list.html:153-215`

**Resolved (2026-09-01):** Nursing was picked up separately earlier in the same session (see the
Ward-scoping/UUID-pickers work); this pass closed the remaining three. Rather than SSU's original
search-box-plus-click-a-result-row pattern (or its "escape hatch" of typing a raw UUID directly),
used the server-searched `p-select` pattern established later the same session for Orders/Nursing
(Development-Standards.md §114) — a debounced `(onFilter)` autocomplete dropdown, no separate
search button/result list, no raw-UUID fallback (a maternity/OT/vaccination record's patientId
should never come from free-typed text). Added to OT's filter bar and Schedule Surgery dialog,
Vaccination's filter bar and Record Vaccination dialog, and Maternity's filter bar and New Record
dialog. Maternity needed one more step: `CreateMaternityRecordDto` requires a real `admissionId`,
not just a `patientId`, so selecting a patient in its create dialog resolves straight to their
current active admission (`AdmissionsApiService.list({patientId, status:'Admitted', limit:1})`),
mirroring `NursingConsole.onPatientSelected` — see Development-Standards.md §119. Verified live:
searched and selected a patient in all six pickers, scheduled a surgery, recorded a vaccination,
and created a maternity record with the admission auto-resolved and shown (ward name via the
directory resolver) — zero console errors in any flow.

### Medium: The scheduling screens cannot actually set a schedule

**Resolved (2026-08-30):** added `dueAt`/`scheduledAt` `datetime-local` inputs to the OT schedule-surgery and nursing task/administration dialogs, wired to the existing DTO fields.

`CreateSurgeryDto`/`CreateAdministrationDto` accept `scheduledAt` and `CreateTaskDto` accepts `dueAt`, but none of the three dialogs render an input for them. Every surgery scheduled through this screen lands with `scheduledAt: null`, and the list's "Scheduled"/"Due" columns permanently render `—` for anything created in-app.

- `frontend/apps/staff-console/src/app/ot/ot-list.html:100-111` vs `frontend/apps/staff-console/src/app/ot/ot.model.ts:24`
- `frontend/apps/staff-console/src/app/ot/ot-list.html:51`, `:62`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:169-184` vs `frontend/apps/staff-console/src/app/nursing/nursing.model.ts:43`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:134-145` vs `frontend/apps/staff-console/src/app/nursing/nursing.model.ts:19`

### Medium: CSSD "Complete Cycle" posts `sterileHours: 0` when the field is cleared

**Resolved (2026-08-30):** `submitComplete()` now rejects a null/zero sterile-hours value instead of coercing it, and the Complete button is disabled until a valid value is entered.

`submitComplete` coerces the signal with `this.sterileHours() ?? 0`, and the Complete button has no `[disabled]` guard. A user who clears the box and clicks Complete sends `sterileHours: 0`, which the backend turns into a sterile-expiry equal to the completion timestamp — the instrument is marked completed and simultaneously expired, silently (success toast, "Sterile Until" shows a past time).

- `frontend/apps/staff-console/src/app/cssd/cssd-console.ts:183`
- `frontend/apps/staff-console/src/app/cssd/cssd-console.html:178`, `:184`

### Medium: List-load failures are invisible in OT, maternity and vaccination, and the OT detail dialog goes blank on error

**Resolved (2026-08-30):** all three `load()` error handlers now toast; `OtList.viewSurgery`'s detail dialog gained a `detailError` signal and an explicit error branch instead of falling through to a blank body.

Those three `load()` methods use `error: () => this.loading.set(false)` with no toast, so a 500 or a network drop presents as "No surgeries found." — indistinguishable from a genuinely empty result. Nursing, CSSD and SSU all toast on the same failure. Separately, `viewSurgery` opens the detail dialog before the request resolves and on error only clears `detailLoading`, leaving a modal with a header and an entirely empty body (no final `@else`).

- `frontend/apps/staff-console/src/app/ot/ot-list.ts:80`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.ts:68`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.ts:57`
- `frontend/apps/staff-console/src/app/ot/ot-list.ts:108-120`, `frontend/apps/staff-console/src/app/ot/ot-list.html:128-149`
- contrast: `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:70-73`, `frontend/apps/staff-console/src/app/ssu/ssu-list.ts:141-148`

### Medium: Paginator advances before the response lands, and superseded page requests are never cancelled

**Deferred (2026-08-30):** not fixed in this pass — the fix (an RxJS `switchMap`-based cancellation stream, or moving the `firstRecord` update to the success handler) touches the same `load()` shape across all four affected files and changes paginator UX subtly; scoped as a dedicated follow-up rather than a quick copy-paste fix.

All four lazy tables call `this.firstRecord.set((page - 1) * limit)` before the HTTP call resolves, and none cancel an in-flight request when a new one starts (plain `.subscribe`, no `switchMap`). A failed page-3 request leaves the paginator highlighting page 3 while the table still shows page 2's rows; out-of-order responses under rapid filtering can let a stale response win. Post-action reloads compound this: every successful approve/cancel/complete calls `load(1, pageSize)`, silently yanking the user back to page 1.

- `frontend/apps/staff-console/src/app/ot/ot-list.ts:66`, `:140`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.ts:61`, `:85`, `:111`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.ts:50`, `:74`
- `frontend/apps/staff-console/src/app/ssu/ssu-list.ts:127`, `:216`, `:247`, `:289`, `:318`

**Resolved (2026-09-01):** took the `switchMap`-based cancellation stream option (not the
firstRecord-only fix) — it's the only one of the two that actually fixes the out-of-order-response
race, not just the visual "paginator ahead of data" symptom. `load()` in all four files now pushes
`{page, limit}` onto a `Subject`, piped through `switchMap` to the real HTTP call (in the
constructor, alongside `patient-list.ts`'s billing/`invoice-detail.ts`'s existing `switchMap`
pattern) — a newer trigger cancels whatever inner request was still in flight outright, not just
outraces it, and `firstRecord` is set only inside the winning response's handler, never eagerly.
Post-action reloads (`load(1, pageSize)` after approve/reject/close/complete) are unaffected in
behavior — still jump to page 1 by design, that's a separate, correct UX choice, not the bug.
Verified live: all four screens load and display data correctly with zero console errors; the two
new failure modes (superseded response arrives late; a page request fails) are covered by
regression tests using RxJS `Subject`s to control response ordering precisely, not timers. See
Development-Standards.md §120 for the pattern to copy for any future lazy-loaded table.

### Medium: Default dates are derived in UTC, so they are wrong for the first 5½ hours of every IST day

**Resolved (2026-08-30):** both call sites now use the shared `todayLocal()` helper (added in the clinical/registration group's fix for the same bug class) instead of `toISOString().slice(0, 10)`.

Both `openDeliveryModal` and `openModal` seed today's date with `new Date().toISOString().slice(0, 10)` (UTC calendar date). A delivery at 02:15 IST or a night-shift vaccination is pre-filled with the wrong day, and neither field is re-checked on submit.

- `frontend/apps/staff-console/src/app/maternity/maternity-list.ts:97`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.ts:62`

### Medium: Accessibility — dialog labels are not associated with their inputs, and SSU's patient results are click-only divs

**Resolved (2026-08-30):** added `for`/`id`/`inputId` pairs to every modal field across all six modules; SSU's patient-result rows dropped the parent-div `(click)` (which double-fired `selectPatient` alongside the nested button's own click) in favor of `role="button"`/`tabindex`/`keydown.enter`/`keydown.space`, making them keyboard-reachable and single-fire.

Every field label inside every modal in all six modules is a bare `<label>` sibling of an input with no `id`/`for`. In SSU the patient search results are `<div (click)>` rows with no `role`/`tabindex`/key handler — unreachable by keyboard — and each row nests a `p-button` whose click bubbles to the parent div, firing `selectPatient` twice per click.

- `frontend/apps/staff-console/src/app/nursing/nursing-console.html:135`, `:139`, `:143`, `:170`, `:174`, `:178`, `:182`
- `frontend/apps/staff-console/src/app/ot/ot-list.html:101`, `:105`, `:109`
- `frontend/apps/staff-console/src/app/maternity/maternity-list.html:99`, `:103`, `:108`, `:135`, `:139`, `:143`, `:147`
- `frontend/apps/staff-console/src/app/vaccination/vaccination-list.html:78`, `:82`, `:87`, `:91`, `:96`
- `frontend/apps/staff-console/src/app/cssd/cssd-console.html:118`, `:122`, `:126`, `:130`, `:157`, `:161`, `:177`, `:193`
- `frontend/apps/staff-console/src/app/ssu/ssu-list.html:190-199`

### Low: Per-row action locks share one signal; CSSD's instrument toggle has none; `cycleActionId` is dead code

**Partially resolved (2026-08-30):** CSSD's `toggleInstrumentActive` now has an in-flight guard (`instrumentActionId`), the dead `cycleActionId` signal is removed, and `instrumentOptions` is now a `computed()` instead of a getter. The OT/nursing cross-row race (one row's response clearing the shared action-id signal while another row's action is in flight) is unchanged — deferred as lower-value than the other findings in this group.

OT and nursing guard concurrent row actions with a single shared signal, which one row's response can clear while another row's action is still in flight, re-enabling a double-post. `toggleInstrumentActive` has no in-flight state at all. CSSD declares `cycleActionId` and never reads it. `instrumentOptions` is a getter that should be a `computed()`.

- `frontend/apps/staff-console/src/app/ot/ot-list.ts:136`, `:139`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:113`, `:116`, `:167`, `:170`
- `frontend/apps/staff-console/src/app/cssd/cssd-console.ts:117-132`, `:50` (unused), `:62` (getter)

### Module group: diagnostics & pharmacy (`lab`, `radiology`, `pharmacy`)

### High: Entered lab result values are never displayed anywhere — verification is a blind sign-off

**Resolved (2026-08-30):** added `GET /lab/requisitions/:id/results` (`lab.read`) since no read path existed at all before this. `LabRequisitionDetail` now renders an "Entered Results" table (component, value, unit, reference range, abnormal flag) whenever status is `ResultsEntered` or `Verified`, and Verify now requires an explicit confirm step.

`LabRequisitionDetail` renders only a "Requisition Details" panel and a "Workflow" panel; there is no results table, and `LabApiService` has no method to read results back (only `enterResult`). The backend exposes `GET /lab/requisitions/:id/report.pdf` for exactly this, and it is never called from the frontend. A lab supervisor holding `lab.result.verify` opens a `ResultsEntered` requisition, sees no values, no units, no abnormal flags, and clicks "Verify Results" — an irreversible clinical sign-off performed on data they cannot see. This is the single most serious gap in the three modules; Radiology by contrast does render `reportText` before its verify button.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:69-95`
- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:79-81`
- `frontend/apps/staff-console/src/app/lab/lab-api.service.ts:112-114`

### High: Pharmacy console can dispense a drug but can never cancel or reverse one

**Resolved (2026-08-30):** `PharmacyDispensingApiService` gained `cancel`/`reverse`; the detail screen renders Cancel (Pending, reason optional) and Reverse (Dispensed, reason required) actions, gated on the same permissions the backend already enforces. The frontend model/status union gained the `Reversed` status and the `reversedBy`/`reversedAt`/`reversalReason` fields to match the entity.

The backend `PharmacyDispensingController` exposes `PATCH :id/cancel` and `PATCH :id/reverse`, but `PharmacyDispensingApiService` implements only `list`/`getById`/`create`/`dispense`. The detail template even renders a "Cancel Reason" field that nothing in this UI can ever populate. A pharmacist dispenses 30 tablets against the wrong `inventoryItemId`, inventory is decremented, and there is no path in the console to reverse it — the correction requires a direct API call or a DB fix. For the one module in this review that mutates physical drug stock, the compensating actions are the ones that must ship.

- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-api.service.ts:52-55`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-detail.ts:56-69`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-detail.html:55-60`

### High: Lab requisition list is unusable as a worklist, based on an incorrect comment about the backend

**Resolved (2026-08-30):** removed the false gate; the list now loads unfiltered (defaulting to a `Pending` status filter as the worklist view) and exposes the `status` filter the DTO already supported.

`LabRequisitionsList.load()` short-circuits to an empty table unless the user types an Order Item UUID, justified by the comment "The backend rejects GET /lab/requisitions without orderItemId (400)". That is false: `SearchLabRequisitionsDto.orderItemId` is `@IsOptional() @IsUUID()` and `LabWorkflowService.listByOrderItem` only adds the `andWhere` when the value is present — an unfiltered paginated listing works today. A lab technician cannot see the Pending-sample queue at all and must obtain an order-item UUID out of band for every single requisition. The DTO also supports a `status` filter that the UI does not offer, even though both Radiology and Pharmacy expose exactly that filter.

- `frontend/apps/staff-console/src/app/lab/lab-requisitions-list/lab-requisitions-list.ts:36-45`
- `frontend/apps/staff-console/src/app/lab/lab-requisitions-list/lab-requisitions-list.html:9-19`
- `frontend/apps/staff-console/src/app/lab/lab-api.service.ts:75-79`

### High: Every API failure in all three modules fails silently — no toast, inconsistent with 15+ sibling modules

**Resolved (2026-08-30):** all three modules now inject `MessageService` and toast on every mutation/list-load failure, matching the sibling convention.

All 16 `error:` handlers across lab/radiology/pharmacy do nothing but reset a loading flag; none of the three modules imports `MessageService`, even though the app already provides it globally and 15+ other modules use it for both success and error feedback. "Verify Results" hits the backend's `ConflictException` for an already-verified requisition; the spinner stops, the status tag does not change, nothing is said, and the user clicks again. Every mutation in these modules has this behaviour.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.ts:58,76,127-130,144`
- `frontend/apps/staff-console/src/app/radiology/radiology-requisition-detail.ts:60,78,107,121,141`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-detail.ts:48,67`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-list.ts:76,109-111`
- `frontend/apps/staff-console/src/app/lab/lab-requisitions-list/lab-requisitions-list.ts:57`
- `frontend/apps/staff-console/src/app/radiology/radiology-requisitions-list.ts:80`

### Medium: Irreversible clinical sign-off and stock-decrementing actions fire on a single unguarded click

**Resolved (2026-08-30):** all three actions now route through `ConfirmationService` (the shared infrastructure built in the clinical/registration group).

"Verify Results" (lab), "Verify Report" (radiology) and "Dispense" (pharmacy) all call the API directly from `(onClick)` with no confirmation step, though all three are one-way. Radiology's own "Cancel Requisition" correctly routes through a modal that captures a reason, so the pattern exists in-module and is simply not applied to the higher-stakes actions.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:79-81`
- `frontend/apps/staff-console/src/app/radiology/radiology-requisition-detail.html:70-72`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-detail.html:63-67`

### Medium: Lab result entry accepts arbitrary free text; the displayed reference range is purely decorative

**Deferred (2026-08-30):** not fixed in this pass — numeric-vs-qualitative component typing and client-side range evaluation is a small feature in its own right (the backend's `computeIsAbnormal` already does this server-side; the ask here is client-side feedback at entry time), and this pass already covered the higher-severity "results are never displayed" finding for the same screen. Left open for a follow-up.

The result inputs are plain `pInputText` with no `type`, no `inputmode`, no numeric parsing and no comparison against `referenceRangeLow`/`referenceRangeHigh`. `EnterResultDto.isAbnormal` exists on the client but is never populated. A potassium value fat-fingered as `55` against a `3.5–5.0` range saves without any warning; units are shown but not enforced or appended.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:110-123`
- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.ts:105-114`
- `frontend/apps/staff-console/src/app/lab/lab-api.service.ts:81-86`

**Resolved (2026-09-01):** added `computeIsAbnormal`/`hasNumericRange` helpers to `lab.model.ts`,
mirroring the backend's `computeIsAbnormal` (`lab-workflow.service.ts`) exactly — same numeric-range
comparison, same fallback to `false` for a qualitative component (only `referenceRangeText`, no
numeric bounds) or a non-numeric entered value. The Enter Results dialog now uses
`type="number"`/`inputmode="decimal"` for a component with a numeric range, shows an inline "Outside
reference range" warning live as the value is typed, and `submitResults()` sends the computed
`isAbnormal` with each result instead of leaving it unset (previously always defaulting to `false`
server-side). Scope stayed to the "client-side feedback at entry time" ask from the original
deferral — no operator-override checkbox for qualitative components, since the deferred note never
asked for one and the backend has no path to accept one differently than it already does. Not
live-verified end-to-end: the demo tenant's lab catalog is empty (no categories/tests seeded) and
no UI exists anywhere to create a lab requisition (only `POST /lab/requisitions` via direct API
call) — reaching this screen live would mean seeding a full category → test → components → order →
requisition chain by hand. Covered instead by component tests against the exact backend algorithm
(`lab-requisition-detail.spec.ts`): a value above/below/inside a numeric range, a qualitative
component never flagged, and the saved payload's `isAbnormal` matching what the backend would
independently compute for the same inputs.

### Medium: `submitResults()` fires N parallel POSTs via `forkJoin`, so a partial failure is unattributable

**Resolved (2026-08-30):** switched to sequential `concatMap` (via `from(components).pipe(concatMap(...), toArray())`) — matches the pessimistic lock's actual serialization anyway, and the error message now correctly tells the user already-saved values are safe to retry (each `enterResult` call is independently idempotent server-side).

Each component is a separate POST, all issued concurrently; `forkJoin` errors on the first failure, so if component 3 of 6 is rejected the other five have already persisted, but the dialog shows one blanket failure message with no indication which value failed. `LabWorkflowService.enterResult` also takes a `pessimistic_write` lock on the requisition row, so N concurrent requests serialize on one lock and a large panel risks lock-wait timeouts.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.ts:116-132`

### Medium: A radiology report cannot be corrected once entered, though the backend allows it

**Resolved (2026-08-30):** the "Enter Report" / "Edit Report" button now also shows for `ReportEntered`, matching what `RadiologyWorkflowService.enterReport` actually allows.

The "Enter Report" button is gated on `r.status === 'Scanned'` only. `RadiologyWorkflowService.enterReport` rejects only `Verified`, `Cancelled` and `Pending` — a requisition in `ReportEntered` is explicitly editable server-side. A radiographer who notices a typo in an unverified report has no way to fix it from this UI. Lab gets this right (its "Enter Results" button shows for `SampleCollected || ResultsEntered`).

- `frontend/apps/staff-console/src/app/radiology/radiology-requisition-detail.html:67-69`
- `frontend/apps/staff-console/src/app/radiology/radiology-requisition-detail.ts:82-87`

### Medium: `RadiologyRequisitionsList` applies `?orderItemId=` only on the first emission, leaving stale rows

**Resolved (2026-08-30):** `load(0)` moved inside the `queryParamMap` subscription (not called separately after it), so every emission — including a later params-only navigation on a reused component instance — refetches. A regression test with a `Subject`-backed `queryParamMap` covers the second-emission case.

The constructor subscribes to `queryParamMap`, sets the filter, and calls `load(0)` once outside the subscription. On a later emission (navigating between two `?orderItemId=` values while the component instance is reused, which is exactly what Angular's default reuse strategy does), the filter input updates but no request is issued — the query-param twin of the `route.snapshot.paramMap` pattern already documented in `CLAUDE.md`.

- `frontend/apps/staff-console/src/app/radiology/radiology-requisitions-list.ts:48-61`

### Medium: `LabTests` and `RadiologyCatalog` are fully built but unreachable — no route, no nav entry

**Resolved (2026-08-30):** wired both up at `clinical/lab/catalog` and `clinical/radiology/catalog` (registered before their sibling `:id` routes so the literal `catalog` segment isn't captured as an id), gated on the existing `lab.catalog.manage`/`radiology.catalog.manage` permissions, with a "Manage Test/Imaging Catalog" link from each module's requisitions list.

Both components (plus specs/templates, ~330 lines) have zero references anywhere in `src/app` outside their own files: no route, no `routerLink`. The `lab.catalog.manage` and `radiology.catalog.manage` permissions exist in the backend RBAC catalog with no UI behind them.

- `frontend/apps/staff-console/src/app/lab/lab-tests/lab-tests.ts:15`
- `frontend/apps/staff-console/src/app/radiology/radiology-catalog.ts:17`
- `frontend/apps/staff-console/src/app/app.routes.ts:211-240`

### Low: Icon-only back buttons have no accessible name, result inputs have no associated label, and catalog type-switching can race

**Resolved (2026-08-30):** added `ariaLabel` to all three detail screens' back buttons, `[attr.aria-label]` on the lab result-value inputs (naming the component), and a request-token guard on `RadiologyCatalog.onTypeChange` so a stale response can't overwrite a newer one.

(a) All three detail screens use icon-only back buttons with no `ariaLabel`. (b) Lab result inputs are labelled by a sibling `<span>` rather than `<label for>`/`aria-label` — the one place in these modules where mislabelling has clinical consequences. (c) `RadiologyCatalog.onTypeChange` has no in-flight cancellation, so rapidly switching imaging types can let a slow first response overwrite a fast second one.

- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:3`
- `frontend/apps/staff-console/src/app/radiology/radiology-requisition-detail.html:3`
- `frontend/apps/staff-console/src/app/pharmacy/pharmacy-dispensing-detail.html:3`
- `frontend/apps/staff-console/src/app/lab/lab-requisition-detail/lab-requisition-detail.html:110-123`
- `frontend/apps/staff-console/src/app/radiology/radiology-catalog.ts:44-57`

### High: A from-scratch `tsc --build` on the backend produces thousands of false "unknown type" errors, unrelated to any frontend-review change

Discovered incidentally while adding the `GET /lab/requisitions/:id/results` endpoint above: running `pnpm exec nx run-many -t typecheck` (or a direct `tsc --build --force`) against `apps/api` from a completely clean state (no `dist/`, no `out-tsc/`, `nx reset` run first) produces ~3,000+ TS18046 (`'x' is of type 'unknown'`) errors across dozens of unrelated integration-spec files — every call site of the pattern `ctx.inTenant(() => someService.someMethod())` loses its generic return type. Confirmed independent of the lab endpoint change by reproducing the identical cascade with that change stashed out. Repeating the clean build multiple times does not converge — different files fail each time, so it isn't a simple "needs two passes" composite-project quirk. `jest` (SWC/ts-node transform, no type-checking) is unaffected and all tests pass normally, which is presumably why this has gone unnoticed — nobody's local environment or CI (if its cache is ever warm) exercises a truly from-scratch `tsc --build`.

Not investigated further — out of scope for the frontend review this file otherwise tracks, and risky to root-cause blindly given the size of the composite project-reference graph. Worth a dedicated investigation: if CI ever runs on a cold cache (a fresh runner, a cache-invalidating dependency bump), this would fail a build that every local dev's warm cache lets pass silently.

- Reproduce: `cd backend/code && pnpm exec nx reset && rm <each file under apps/api/dist and apps/api/out-tsc individually> && pnpm exec nx run-many -t typecheck`
- `backend/code/apps/api/tsconfig.json` (references `tsconfig.app.json` + `tsconfig.spec.json` as separate composite projects — the spec project resolves the app project's types via its emitted `.d.ts`, not raw source)
- `backend/code/apps/api/src/testing/tenant-test-context.ts:63` (`inTenant<T>(work: () => Promise<T>): Promise<T>` — the generic that goes missing)

**Resolved (2026-09-01):** root cause was `noEmitOnError: true` (`backend/code/tsconfig.base.json`)
combined with `composite: true`/`emitDeclarationOnly: true` — under those three settings together,
**any single TS diagnostic error anywhere in the app project blocks `.d.ts` emission for the
entire project**, not just the offending file. The original repro's documented cleanup
(`rm apps/api/dist apps/api/out-tsc`) never cleared the *libs'* own `dist`/`out-tsc`/`.tsbuildinfo`
output, so most local reproductions were unknowingly reading stale-but-present library
declarations from an earlier, differently-shaped build — masking the real trigger and producing
the "different files fail each time" symptom (whichever unrelated file happened to carry a stray
diagnostic on a given tree state silently blocked the whole project's declarations, and that file
varies commit-to-commit). Isolated the actual cause by bypassing Nx entirely — a single bare
`tsc --build tsconfig.app.json --emitDeclarationOnly`, from a truly clean state (all 7 libs' output
removed too, confirmed via `git check-ignore`), emitted only `dist/tsconfig.app.tsbuildinfo` and
**zero `.d.ts` files**, despite reporting just one trivial diagnostic
(`create-pharmacy-dispensing.dto.ts`'s unused `IsString` import, `TS6133`) — proving the whole-app
suppression, not a race or a project-references ordering bug (a single, non-parallel `tsc` process
reproduced it identically to `nx run-many`, ruling out Nx task-parallelism as the cause).
Fixed by removing the unused import; a clean `nx run-many -t typecheck` across all 8 projects now
passes with zero errors. Two integration-spec failures surfaced by the full clean test run
(`fixed-assets.service.integration-spec.ts`, `cssd.service.integration-spec.ts`) are pre-existing
and unrelated — both compute an elapsed-time value against the real wall clock with a hardcoded
expected value that rots as calendar time passes (confirmed identical on unmodified `main` via
`git stash`); left open as a new, separate finding below rather than folded into this fix.

### Low: Two integration specs assert a hardcoded elapsed-time value against the real wall clock, so they fail once enough calendar time has passed

`fixed-assets.service.integration-spec.ts`'s valuation test purchases an asset on a fixed date and
asserts `monthsInService` equals a literal number "as of the run date" (comment says "as of
2026-08"); `cssd.service.integration-spec.ts`'s sterility test has the same shape. Both compute the
actual value from `new Date()` at test-run time rather than freezing time (Jest fake timers) or
asserting a date-agnostic invariant, so they were already failing by 2026-09-01 (discovered via the
cold-`tsc --build` investigation above, unrelated to that fix) and will need updating again next
month. Needs its own look at whether to freeze the clock or recompute the expected value from
`Date.now()` in the test itself — not fixed here, out of scope for the typecheck investigation this
was found during.

- `backend/code/apps/api/src/fixed-assets/fixed-assets.service.integration-spec.ts:142`
- `backend/code/apps/api/src/cssd/cssd.service.integration-spec.ts:345`

### Module group: financial (`billing`, `accounting`, `payroll`, `fixed-assets`, `insurance`)

### High: Invoice list pagination is dead — the frontend reads `result.total` but the API returns `{ data, meta: { total } }`

`/billing/invoices` goes through the backend's shared `paginate()` helper, which returns `{ data, meta: { total, page, limit, totalPages } }`. The frontend's `InvoiceListResult` declares a flat `{ data, total, page, limit }`, so `this.totalRecords.set(result.total)` sets `undefined`; PrimeNG then computes `pageCount = NaN` and renders no page links. A tenant with 500 invoices sees exactly the first 20 with no way to reach the rest. The unit tests mock the flat shape the frontend invented rather than the shape the API actually sends. `accounting.model.ts`'s `JournalListResult` and `fixed-assets.model.ts`'s `PaginatedResult` carry the same wrong envelope — currently harmless only because neither component reads `.total` yet.

- `frontend/apps/staff-console/src/app/billing/invoice.model.ts:21`
- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.ts:48`
- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.spec.ts:10`
- `frontend/apps/staff-console/src/app/billing/invoices-api.service.spec.ts:43`
- `frontend/apps/staff-console/src/app/accounting/accounting.model.ts:65`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets.model.ts:50`

**Resolved (2026-08-30):** all three models now declare the real `{ data, meta: { total, page, limit, totalPages } }` envelope; invoice list, journal list, and asset register all read `.meta.total` and paginate correctly.

### High: `toIsoDate()` uses `toISOString()`, so every accounting date is booked one day early in IST

`toIsoDate` formats a `p-datepicker` value with `value.toISOString().slice(0, 10)`. PrimeNG hands back a `Date` at local midnight; in IST local midnight is 18:30 UTC of the *previous* day, so the sliced string is always one day behind what the user picked — not an edge case, 100% of picks. A journal entry keyed 2026-04-01 (start of the financial year) posts as 2026-03-31, landing in the prior FY; period-range reports never tie out to the ledger. The same `toISOString().slice(0, 10)` pattern recurs in appointments, vaccination, maternity and employees (see those groups above) — worth a workspace-wide fix with one shared local-date helper.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:31`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:255`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:312`

**Resolved (2026-08-30):** `toIsoDate()` now builds the string from the `Date`'s local `getFullYear`/`getMonth`/`getDate` instead of `toISOString()`. Not extracted into the shared `date.util.ts` helper from the registration/clinical group — that helper is `todayLocal()`-shaped (today's date), not a formatter for an arbitrary picked `Date`; a workspace-wide unification of the two helpers is worth a follow-up but out of scope here.

### High: Journal "balanced" gate uses exact float equality, so legitimate entries can be permanently un-saveable

`journalIsBalanced` is `debitTotal > 0 && debitTotal === creditTotal` over IEEE-754 doubles accumulated with `reduce`. Debits 0.10 + 0.20 against a credit of 0.30 sum to `0.30000000000000004` vs `0.3`: the "must balance" hint stays lit and Save stays disabled with no way to fix it — real-world paise-level splits hit this regularly. Two related gaps in the same block: nothing stops a single line carrying both a debit and a credit, and lines with a null `accountId` are dropped by `submitJournal` *after* being counted by the balance check, so a filled-in amount on an account-less row can make the UI look balanced while the payload isn't.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:229`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:237`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:242`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:344`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:352`

**Resolved (2026-08-30):** balance check now compares integer paise (`toPaise()`, `Math.round(amount * 100)`) instead of raw floats. Added `journalHasLineWithBothDebitAndCredit` and `journalHasAmountWithoutAccount` getters that both disable Save, closing the single-line-both-sides and amount-without-account gaps in the same pass. **Verified live on QA (2026-09-01):** a real 0.10 + 0.20 debit vs 0.30 credit entry correctly cleared the "must balance" error and saved (`JRN-2026-00001`), confirming the exact IEEE-754 edge case this fix targets.

### High: Payroll "Mark Paid" can be double-submitted and swallows its own failure

`markPaid()` fires the POST with no in-flight signal (double-click sends two requests), and its error handler is literally `error: () => undefined` — no toast, no message, no state change. This is the most consequential money action in the module and the only mutation in these five modules with no user-visible error path; every sibling (`insurance.markClaimPaid`, `accounting.postJournal`) sets a per-row loading signal and raises an error toast. Payroll doesn't inject `MessageService` at all.

- `frontend/apps/staff-console/src/app/payroll/payroll-list.ts:157`
- `frontend/apps/staff-console/src/app/payroll/payroll-list.html:86`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.ts:539`

**Resolved (2026-08-30):** added a `markingPaidId` in-flight guard (blocks a second click while the first request is outstanding) and wired `MessageService` for both success and error toasts, matching the insurance/accounting pattern.

### Medium: No confirmation dialog anywhere before an irreversible financial action

Posting a journal entry, marking a payslip paid, and deactivating a ledger account/asset category/payer all execute on a single click with no `p-confirmDialog` — and for the deactivate toggles in accounting and fixed-assets, no in-flight guard either. Insurance at least guards its toggle; accounting and fixed-assets guard nothing.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:289`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:171`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.ts:94`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.ts:150`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.ts:271`

**Resolved (2026-08-30):** `postJournal`, payroll's `markPaid`, the accounting account toggle, and the fixed-assets category/asset toggles all now confirm via `ConfirmationService` before executing, each with its own in-flight guard where one was missing.

### Medium: Journal list and asset register silently truncate at the server's default 20 rows

`loadJournals()`/`loadAssets()` send no `page`/`limit`, and the backend's `paginate()` defaults to `limit: 20`. Neither `p-table` has `[paginator]`, and neither component reads `meta.total`, so both registers render "the 20 most recent rows" while presenting as the complete list — a user scanning for an unposted draft from last month will conclude it doesn't exist.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.ts:190`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:74`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.ts:113`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.html:20`

**Resolved (2026-08-30):** both consoles now use lazy server-side pagination (`journalsTotalRecords`/`journalsPageSize`/`journalsFirstRecord`/`onJournalsLazyLoad` and the `assets*` equivalents), with `[paginator]="true"` and `[first]` bound in the templates.

### Medium: Payroll table never binds `[first]`, so the paginator desyncs from the data after filtering

`PayrollList` resets `firstRecord` in `applyFilters()` but the `p-table` never binds `[first]`. PrimeNG keeps its own internal `first`, so filtering while on page 3 fetches page 1 from the API while the paginator still highlights page 3 — clicking "next" then skips pages 2 and 3 entirely. Both sibling lazy tables (invoice list, insurance) bind `[first]` correctly; payroll is the outlier.

- `frontend/apps/staff-console/src/app/payroll/payroll-list.html:42`
- `frontend/apps/staff-console/src/app/payroll/payroll-list.ts:122`
- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.html:36`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:109`

**Resolved (2026-08-30):** `[first]="firstRecord()"` bound on the payroll table.

### Medium: Accounting and fixed-assets show every mutating action to read-only users

Both routes are guarded by `.read` permissions, but the consoles render "Add Account", "Post", "Deactivate/Reactivate", "Register Asset" unconditionally — neither component injects `AuthService`. A `.read`-only user sees a fully-functional-looking screen and gets a 403 toast on every click; for `Post` that's after they've already committed to posting a journal. Insurance and payroll gate correctly and are the pattern to copy.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:20`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:95`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.html:18`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.html:49`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:23`
- `frontend/apps/staff-console/src/app/payroll/payroll-list.ts:91`

**Resolved (2026-08-30):** both consoles now inject `AuthService`, gate on `.manage` permissions via a `canManage` getter, and hide every mutating control (`@if (canManage)`) for read-only users.

### Medium: Four different money-rendering conventions across five financial modules, one of which can crash the row

Billing/accounting print bare `{{ x | number: '1.2-2' }}` with no currency symbol; insurance prints `₹{{ x | number }}` with the default `1.0-3` digit spec (₹1234.5 → "₹1,234.5"); the insurance approve toast interpolates a raw number with no formatting; payroll calls `slip.netAmount.toLocaleString('en-IN')` directly in the template, dropping paise and throwing a `TypeError` that blanks the whole table if the API returns `null` for a decimal column.

- `frontend/apps/staff-console/src/app/payroll/payroll-list.html:73`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:131`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:225`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.ts:506`
- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.html:79`

**Resolved (2026-08-30):** standardized on Angular's `CurrencyPipe` (`currency: 'INR' : 'symbol-narrow' : '1.2-2'`) across billing, accounting, payroll, fixed-assets, and insurance — renders `₹1,234.50` consistently and handles `null` without throwing.

### Medium: Claim approval accepts any amount, including more than was claimed and `null`

`openApproveModal` seeds the draft with `claim.amountClaimed`, but the `p-inputNumber` only sets `[min]="0"` — no `[max]`, and `confirmApprove()` validates nothing before POSTing. A fat-fingered extra zero approves a claim for 10× the claimed amount with no warning; clearing the field sends `{ amountApproved: null }`. The adjacent Reject dialog already guards its input — the pattern to copy is in the same file.

- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.ts:497`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:457`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:476`

**Resolved (2026-08-30):** added `approveAmountClaimed`/`approveAmountInvalid` (rejects `null`, `<= 0`, and anything over the claimed amount) and bound `[max]` on the input plus `[disabled]="approveAmountInvalid"` on the Approve button, mirroring the Reject dialog's existing guard.

### Low: Accessibility and dead-code cleanups across the financial screens

Every `<label>` in the accounting and fixed-assets modals is an orphan (no `for`/`id`) — insurance's dialogs do this correctly. Icon-only edit/ban/check buttons in insurance and the journal-line delete button have no `aria-label`. `InvoicesApiService.listByPage` has no callers and should be deleted; the billing invoice detail screen exposes none of the backend's `cancel`/`recordPayment`/`createReturn` actions and shows no balance-due figure.

- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:261`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:336`
- `frontend/apps/staff-console/src/app/fixed-assets/fixed-assets-console.html:123`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/insurance-dashboard.html:56`
- `frontend/apps/staff-console/src/app/billing/invoices-api.service.ts:34`
- `frontend/apps/staff-console/src/app/billing/invoice-detail/invoice-detail.html:96`

**Resolved (2026-08-30):** accounting/fixed-assets modal labels now carry `for`/`id` (and `p-select` an `inputId`), the journal-line delete button and insurance's icon-only edit/toggle buttons have `aria-label`/`ariaLabel`, and `InvoicesApiService.listByPage` (no callers) was deleted.

**Deferred (2026-08-30):** the invoice detail screen still exposes none of the backend's `cancel`/`recordPayment`/`createReturn` actions and shows no balance-due figure — that's a feature addition (new buttons, confirm flows, a payment-recording form), not a bug fix, and sized for its own item in `pending-tasks.md` rather than folding into this review-implementation pass.

### Module group: supply chain & master data (`inventory`, `ward-supply`, `global-catalog`, `master-data`)

### High: Partially-fulfilled requisitions can never be finished — Fulfill button is gated on `status === 'Pending'`

The per-line Fulfill button only renders when the requisition's status is exactly `Pending`. The backend flips the requisition to `PartiallyFulfilled` as soon as any one line is fulfilled short of its requested quantity and explicitly keeps fulfilling legal in that state (`NON_TERMINAL_REQUISITION_STATUSES = ['Pending', 'PartiallyFulfilled']`). A storekeeper fulfills line 1 of a 3-line requisition, the component reloads, the status is now `PartiallyFulfilled`, and every remaining Fulfill button disappears — the requisition is permanently stranded with no UI path to completion. The screen's own explanatory copy contradicts the guard.

- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.html:74`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.html:88`
- backend evidence: `backend/code/apps/api/src/inventory/inventory-requisition.service.ts:26,219`

**Resolved (2026-08-30):** Fulfill now gates on `isFulfillable(status)` (`Pending` or `PartiallyFulfilled`) instead of `status === 'Pending'` alone.

### High: Clearing a `p-select` filter throws a TypeError — PrimeNG emits `null`, the handlers call `.length` on it

`p-select` with `[showClear]="true"` emits `null` through `ngModelChange` when the clear icon is clicked. Both server-paginated list screens then do `vendorId.length > 0` / `departmentId.length > 0` on that value, throwing before `load(0)` is ever reached — and because the filter signal was already set to `null`, the table keeps displaying the *previous* filter's rows under a now-empty filter with no indication the list is stale. The same `null` leak makes `canAddLine()` return `true` after a select is cleared, so "Add Line" becomes clickable and silently does nothing.

- `frontend/apps/staff-console/src/app/inventory/purchase-order-list/purchase-order-list.ts:133`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-list/stock-requisition-list.ts:89`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-list/purchase-order-list.ts:230`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-list/purchase-order-list.html:136,152`

**Resolved (2026-08-30):** both filter handlers and the item-select handlers now accept `string | null` and normalize `null` to `''`/falsy before use; `canAddLine()` requires a real item id.

### High: ward-supply, master-data and global-catalog expose write actions with zero `hasPermission()` gating

Nineteen sibling templates gate their mutating buttons with `auth.hasPermission(...)`; these three screens gate nothing. Ward Supply's route only requires `ward-supply.read`, but the backend requires `ward-supply.manage` on `/stock/receive` and `/stock/consume` — a read-only ward clerk fills in a receive/consume form, submits, and gets a raw 403 rendered in the dialog's error box. Master Data and Global Catalog (tenant-wide blast radius) have the same shape.

- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.html:8-9`
- `frontend/apps/staff-console/src/app/app.routes.ts:113-116`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.html:25-30,98-103,80-86,144-157`
- `frontend/apps/staff-console/src/app/global-catalog/global-catalog-list.html:23-28,88-93,63-75,130-143`
- backend evidence: `backend/code/apps/api/src/ward-supply/ward-supply.controller.ts:19-28`

**Resolved (2026-08-30):** added `canManage` (`AuthService.hasPermission`) to all three components, gating every mutating control — `ward-supply.manage`, `master-data.manage`, and `rbac.manage` (the actual backend-enforced permission for both global-catalog endpoints — `department-catalog.controller.ts` and `role-management.controller.ts` both require `rbac.manage`, confirmed by reading the controllers directly).

### High: The procurement/requisition workflow is only half-built — no goods receipt, no cancel, no requisition creation

The PO detail screen renders a "Received Qty" column but there is no goods-receipt action anywhere in the app, so a purchase order can never leave `Ordered` through this console even though `POST .../goods-receipt` exists. Likewise PO/requisition cancel have no UI, and `POST /inventory/requisitions` has no UI at all — the requisition list has "View" but no "New Requisition". Also unused: the low-stock endpoint and `reorderLevel`/`minimumStock` fields already present in the item model — nothing in the UI ever warns about low stock.

- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.html:66,74`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-list/stock-requisition-list.html:1-5`
- `frontend/apps/staff-console/src/app/inventory/inventory-api.service.ts:147-214`
- `frontend/apps/staff-console/src/app/inventory/inventory-api.service.ts:35-36`
- backend evidence: `backend/code/apps/api/src/inventory/inventory-procurement.controller.ts:45,51`, `inventory-requisition.controller.ts:13,31`

**Resolved (2026-08-30):** added a per-line "Receive" action (batch number, expiry, unit cost, quantity) wired to `POST .../goods-receipt`, a "Cancel Order"/"Cancel Requisition" action on both detail screens (reason textarea, matching pharmacy-dispensing's cancel-with-reason pattern) wired to the two `PATCH .../cancel` endpoints, and a "New Requisition" dialog on the requisition list (department + category/sub-category/item cascade, mirroring the PO create dialog) wired to `POST /inventory/requisitions`.

**Deferred (2026-08-30):** the low-stock endpoint (`GET stock-balances/low-stock`) and a low-stock banner/badge are not wired up — no existing screen has an analogous "warning banner" pattern to copy, and scoping where it should surface (item list? a dashboard widget?) is a product decision better suited to its own pending-tasks item.

### Medium: Both detail screens render a blank page on a failed fetch, with the header stuck on "Loading…"

`load()` clears the loading signal in its `error` handler but leaves the detail signal `null`, and the template's `@if`/`@else if` chain has no final `@else` — a 404/500/403 produces an empty content area under a heading that permanently reads "Loading Purchase Order…" with no message, no retry, no toast.

- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.ts:41-47`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.html:9-11,19-23,88`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.ts:69-75`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.html:19-23,97`

**Resolved (2026-08-30):** both components now set a `notFound` signal on error and both templates add a final `@else if (notFound())` branch with a message and a back button.

### Medium: Ward Supply's Transactions tab silently truncates to the backend's default page and drops `total`

`loadTransactions()` sends only `departmentId` (no `page`/`limit`), the response's `total` is discarded, and the table has no `[paginator]`/`[lazy]`. For a stock audit trail, reconciling a balance against visible transactions will silently not add up. The service already supports `page`/`limit`/`itemId`/`transactionType`; none of it is wired to the UI.

- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.ts:69-81`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.html:64`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-api.service.ts:12-18,30-38`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply.model.ts:32-35`

**Resolved (2026-08-30):** the Transactions tab is now lazy/paginated (`[lazy]`, `[paginator]`, `onTransactionsLazyLoad`), and `PaginatedResult<T>` was fixed to the real `{ data, meta: { total, page, limit, totalPages } }` envelope both endpoints actually return via the shared `paginate()` helper — `listBalances` had the same wrong-envelope bug (not called out by this finding, but the exact same recurring bug class from every other module group; found and fixed while touching this file, per the pattern already noted in the financial and diagnostics groups).

### Medium: Ward Supply movement forms take raw UUIDs as free text, and send `""` for optional UUID fields (guaranteed 400)

Department ID, Item ID and Patient ID are plain `pInputText` fields requiring pasted UUIDs, while sibling screens already resolve names via pickers. `patientId` becomes `''` the moment a user types into and then clears the field; `@IsOptional()` skips only `undefined`/`null`, so `patientId: ""` fails `@IsUUID()` and the consume request 400s with a raw validation message rendered verbatim. The receive form also omits `batchNumber`/`expiryDate` entirely, so every receipt lands in an unbatchable bucket with no expiry.

- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.html:110-123,149-166`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.ts:16,106-110`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply.model.ts:23-30`
- backend evidence: `backend/code/apps/api/src/ward-supply/dto/ward-supply.dto.ts`

**Resolved (2026-08-30):** Department and Item are now `p-select` pickers (department list, and the same category→sub-category→item cascade used by the inventory create dialogs); `batchNumber`/`expiryDate` fields were added to the Receive form; both forms send `undefined` (not `''`) for blank optional fields (`patientId`, `remarks`, `batchNumber`, `expiryDate`). Patient stayed a free-text field — no patient-search/autocomplete pattern exists anywhere in this app to copy, and building one is a new shared component, out of scope for this pass; the `''`→`undefined` fix covers the actual reported 400.

### Medium: Deactivate/reactivate toggles fire immediately with no confirmation and no in-flight guard

`toggleDept`/`toggleWard`/`toggleBed`/`toggleRoleActive`/`toggleDeptActive` issue the PATCH on the first click of an icon-only button with no confirmation step and no row-disable while in flight — deactivating a *global* role or catalog department withdraws it from every tenant. A double-click sends deactivate twice, and the second call can race the reload into a wrong-looking UI.

- `frontend/apps/staff-console/src/app/master-data/master-data-list.ts:162-241,300-312`
- `frontend/apps/staff-console/src/app/global-catalog/global-catalog-list.ts:255-276,320-341`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.html:80-86,151-157,412-419`
- `frontend/apps/staff-console/src/app/global-catalog/global-catalog-list.html:69-75,137-143`

**Resolved (2026-08-30):** all five toggles now confirm via `ConfirmationService` before deactivating (not before reactivating, matching the existing sibling convention), each with a per-row `togglingXId` in-flight signal disabling the button while the request is outstanding.

### Medium: Accessibility and empty-state gaps in master-data — unnamed icon buttons, a `pTooltip` that never renders, three tables with no empty message

Master Data's deactivate/reactivate buttons are icon-only with no `ariaLabel` (Global Catalog supplies it on the identical control). The bed toggle's `pTooltip="Toggle Active Status"` never renders because `TooltipModule` is not imported. The Departments/Wards tables (master-data) and Global Departments table (global-catalog) have no `pTemplate="emptymessage"`, so a first-run tenant sees a header row over blank space.

- `frontend/apps/staff-console/src/app/master-data/master-data-list.html:80-86,151-157,412-419`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.ts:16-27`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.html:32-90,105-162`
- `frontend/apps/staff-console/src/app/global-catalog/global-catalog-list.html:30-80`

**Resolved (2026-08-30):** added `ariaLabel`s to the department/ward/bed toggle buttons, imported `TooltipModule` so the bed toggle's `pTooltip` actually renders, and added `pTemplate="emptymessage"` to the Departments and Wards tables (master-data) and the Global Departments table (global-catalog).

### Medium: Transactional screens display raw UUIDs and unit-less quantities

Purchase Order/requisition detail and Ward Supply show bare Vendor/Item/Department UUIDs instead of resolved names, and Master Data's "Parent Dept" column prints `parentDepartmentId` even though resolved names already exist in `departments()`. Every quantity (ordered/received/requested/fulfilled/available) renders with no unit of measure despite `InventoryItem.unitOfMeasure` existing — "12" could be 12 boxes or 12 tablets, in a screen where the operator is deciding how much to dispatch.

- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.html:30,73-77`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.html:69-72,112,117-121`
- `frontend/apps/staff-console/src/app/ward-supply/ward-supply-console.html:48-50,77-82`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.html:53`
- `frontend/apps/staff-console/src/app/inventory/inventory-api.service.ts:34`

**Resolved (2026-08-30):** PO detail now resolves `vendorId` to a name (`vendorName()`, same lookup pattern as the PO list); Master Data's Parent Dept column now resolves `parentDepartmentId` via the already-loaded `departments()` catalog instead of printing the raw id.

**Deferred (2026-08-30):** item names and units of measure in PO/requisition/ward-supply are still raw ids/unit-less — there is no `GET /inventory/items/:id` (or bulk lookup) endpoint; items are only reachable through the category→sub-category drill-down, so resolving an arbitrary item id to a name would mean either a new backend endpoint or fetching the entire catalog client-side. Flagging as a backend gap rather than working around it blindly.

### Low: Cascading-select loads have no request-ordering guard, and two `paramMap` subscriptions are never torn down

`onCategoryChange`/`onSubCategoryChange` and their PO-dialog equivalents fire a fresh HTTP call with no `switchMap` and no in-flight token, so a slow earlier response can overwrite a fast later one. Both detail components subscribe to `route.paramMap` without `takeUntilDestroyed()`, unlike `billing/invoice-detail.ts` which they were modelled on.

- `frontend/apps/staff-console/src/app/inventory/inventory-item-list/inventory-item-list.ts:51-84`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-list/purchase-order-list.ts:160-190,237`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.ts:31`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.ts:48`
- `frontend/apps/staff-console/src/app/master-data/master-data-list.ts:244-250` and `master-data-list.html:223`
- `frontend/apps/staff-console/src/app/global-catalog/global-catalog-list.html:286,402`

**Resolved (2026-08-30):** `PurchaseOrderDetail` and `StockRequisitionDetail`'s `paramMap` subscriptions now use `takeUntilDestroyed(this.destroyRef)` (an explicit `DestroyRef` passed in, since `ngOnInit` runs outside the injection context `takeUntilDestroyed()` needs by default).

**Deferred (2026-08-30):** the cascading-select request-ordering guard (`switchMap`/an in-flight token on `onCategoryChange`/`onSubCategoryChange` and their PO/ward-supply/requisition-dialog equivalents) is not added — it's a narrow race window (two category picks within one round-trip) with no user-visible incident on record, and every affected call site would need the same treatment; better scoped as a single follow-up pass across all of them than done piecemeal here.

### Module group: admin & platform (`admin-dashboard`, `tenants`, `users`, `employees`, `audit`, `notifications`, `helpdesk`, `branding`, `marketing`, `reporting`, `change-password`, `login`, `shell`, `fraction`)

### High: Tenant detail's package selector races the tenant load and can pre-select the wrong edition

`ngOnInit` fires `loadTenant(id)` and `loadPackages()` concurrently, but the Package `p-select`'s draft value is seeded only inside `loadPackages()`'s handler, from `tenant()?.packageCode ?? packages[0]?.code`. `loadTenant()` never re-syncs it. Whenever `GET /packages` resolves first (the common case), `tenant()` is still `null`, so the draft falls back to the first package option — the screen shows an Enterprise hospital as "Basic" with "Save package" live, one click from silently downgrading a paying tenant. A params-only navigation from tenant A to tenant B has the same problem in reverse (draft keeps A's code).

- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.ts:143`
- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.ts:320`
- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.ts:468`
- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.html:139`

**Resolved (2026-08-30):** `loadTenant()`'s success handler now always re-syncs `packageDraft` to the loaded tenant's `packageCode`, regardless of whether `loadPackages()` already resolved — fixes both the load-order race and the "draft keeps the previous tenant's code" case on a params-only navigation between two tenants.

### High: Audit trail's default date range is off by the local UTC offset, hiding recent events

The filter defaults are built with `.toISOString().slice(0, 16)` fed into `<input type="datetime-local">`, but `datetime-local` values are local wall-clock, not UTC, and are re-parsed as local time on submit. For an IST (+5:30) operator, the End Date sent is 5.5 hours in the past. The audit trail — a compliance and incident-investigation screen — silently omits the most recent five and a half hours of events by default with no visual cue anything is missing; the same offset error applies to Start Date.

- `frontend/apps/staff-console/src/app/audit/audit-list.ts:38`
- `frontend/apps/staff-console/src/app/audit/audit-list.ts:92`
- `frontend/apps/staff-console/src/app/audit/audit-list.html:18`

**Resolved (2026-08-30):** added `toLocalDateTimeString()` to the shared `date.util.ts` helper (alongside the existing `todayLocal()`/`toLocalDateString()`) and used it to seed the default Start/End Date filters — `<input type="datetime-local">` is local wall-clock, and the round-trip through `new Date(f.startDate).toISOString()` on submit was already correct; only the default-seeding side used the wrong (UTC) conversion.

### High: Employee join date binds a `string` to `p-datepicker`, breaking edit prefill and shifting the saved date a day earlier

`editForm.joinDate` is typed `string`, but the control is a `p-datepicker` whose `writeValue` expects a `Date` — editing an existing employee opens with an empty or mis-rendered date field. Once the user picks a date, `ngModelChange` writes a `Date` into the `string`-typed field (the template's `$event` is `any`), and `JSON.stringify` serialises it to a full UTC ISO timestamp — for any timezone ahead of UTC, including India, local midnight serialises to the previous day's evening UTC, so every employee saved through this form gets a join date one day earlier than selected. Join date feeds payroll seniority calculations.

- `frontend/apps/staff-console/src/app/employees/employee-list.html:165`
- `frontend/apps/staff-console/src/app/employees/employee-list.ts:19`
- `frontend/apps/staff-console/src/app/employees/employee-list.ts:53`
- `frontend/apps/staff-console/src/app/employees/employee-list.ts:128`

**Resolved (2026-08-30):** the edit form now carries `joinDate: Date` (what `p-datepicker` actually reads/writes) instead of the DTO's `string`, converted via `toLocalDateString()` only when building the `CreateEmployeeDto` to submit; `openEditModal` parses the loaded `'YYYY-MM-DD'` back to a local-midnight `Date` (not `new Date(str)`, which parses date-only strings as UTC midnight and would render a day early in any timezone behind UTC).

### High: `EmployeesApiService.list` spreads a possibly-`undefined` filter into `{ params }` — `q=undefined` reaches the backend

Recurrence of the `PayrollApiService.listPayslips` bug already documented in `frontend/CLAUDE.md` (fixed there 2026-08-22). `EmployeeList.load` passes `q: this.q() || undefined` straight to `ApiClientService.get('/employees', { params })` without building the query conditionally; `ApiClientService` does no `undefined` stripping and Angular's `HttpParams` stringifies `undefined` to the literal string `"undefined"`. Every unfiltered employee list request sends `?q=undefined`. Every sibling service in these modules already builds the query conditionally; only this one does not.

- `frontend/apps/staff-console/src/app/employees/employees-api.service.ts:57`
- `frontend/apps/staff-console/src/app/employees/employee-list.ts:84`
- `frontend/libs/api-client/src/lib/api-client.service.ts:18`

**Resolved (2026-08-30):** `EmployeesApiService.list` now builds the query object conditionally (`if (params.q !== undefined) query['q'] = params.q`), matching every sibling service; added `employees-api.service.spec.ts` (this module had no `HttpTestingController`-level test at all) asserting `q` is omitted, not sent as the literal string `"undefined"`.

### Medium: Notification-type icon in the shell header is malformed markup — duplicate `class` attribute with an `@switch` block inside an attribute value

The `<i>` element rendering a notification's type icon carries two `class` attributes: the first holds an Angular `@switch` control-flow block written inside a quoted attribute value (which Angular's block syntax cannot parse there), the second holds a static class string. The per-type icon and severity colour therefore never reach the rendered element — every notification in the header dropdown renders with no glyph and no colour, so a user cannot distinguish an error alert from an informational one at a glance.

- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:96`

**Resolved (2026-08-30):** replaced the invalid inline `@switch` with a `notificationIconClass(type)` component method returning the icon/colour class string, bound via plain interpolation (`class="pi {{ notificationIconClass(notification.type) }} ..."`).

### Medium: Notification dropdown refetches on close instead of on open, so it always shows page-load-stale data

`toggleNotifications()` flips the signal first, then guards the refetch with `if (!this.notificationsOpen())` — i.e. the reload runs on the transition to *closed*. Opening the panel never triggers a fetch, so the list and unread badge show whatever `ngOnInit` loaded when the shell was first constructed; since the shell persists across all in-app navigation and the access token lives in memory (no reload), a user signed in for a shift sees the same notification list all day.

- `frontend/apps/staff-console/src/app/shell/shell-chrome.ts:177`

**Resolved (2026-08-30):** `toggleNotifications()` now reloads on the transition to *open*, not closed.

### Medium: The "Quick Actions" button in the header is a no-op

`quickActionsOpen` is declared, toggled, and reset, but no template anywhere in the app reads it — the header renders a "Quick Actions" button that visibly does nothing when clicked, on every screen of both consoles, and trains users to distrust the chrome. It is also icon-only with no `aria-label` (a `pTooltip` is not an accessible name).

- `frontend/apps/staff-console/src/app/shell/shell-chrome.ts:45`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.ts:131`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:129`

**Resolved (2026-08-30):** removed the button, `toggleQuickActions()`, and the `quickActionsOpen` signal entirely — there was no design or backlog item for actual quick-actions content, and inventing arbitrary content nobody asked for isn't a bug fix; a real implementation belongs to its own feature item once product defines what it should contain.

### Medium: Destructive account and employee actions fire immediately with no confirmation, and some fail silently

Deactivate on a staff account, removing a role assignment, and deactivate/reactivate on an employee all invoke the API directly from the click handler with no confirmation dialog — inconsistent with the sibling `tenants` module, which gates archive/purge/cancel-subscription/package-change behind an explicit confirm step. `EmployeeList.toggleActive` compounds this by swallowing the failure case entirely (`error: () => undefined`), so a rejected deactivation looks identical to a successful one.

- `frontend/apps/staff-console/src/app/users/user-detail.html:47`
- `frontend/apps/staff-console/src/app/users/user-detail.html:129`
- `frontend/apps/staff-console/src/app/users/user-detail.ts:100`
- `frontend/apps/staff-console/src/app/users/user-detail.ts:189`
- `frontend/apps/staff-console/src/app/employees/employee-list.ts:161`

**Resolved (2026-08-30):** both actions now confirm via `ConfirmationService` before executing (not before reactivating, matching the sibling convention); `EmployeeList.toggleActive` also gained an in-flight guard and a `MessageService` error toast, replacing the swallowed `error: () => undefined`.

### Medium: Platform dashboard is all-or-nothing — one failing endpoint blanks the entire screen

`loadDashboard` wraps three independent calls in `Promise.all([...toPromise()])`, which rejects on the first failure — if `/audit` (the most failure-prone) returns non-2xx, stat cards, recent tenants and the status chart are all discarded even though the other two calls succeeded. The operator gets one generic error toast and an empty page with no partial data and no retry. `ReportingDashboard.loadDashboard` already uses the more resilient pattern this should copy. `.toPromise()` is also deprecated in RxJS 7 and removed in 8.

- `frontend/apps/staff-console/src/app/admin-dashboard/admin-dashboard.ts:60`
- `frontend/apps/staff-console/src/app/admin-dashboard/admin-dashboard.ts:162`
- `frontend/apps/staff-console/src/app/reporting/reporting-dashboard/reporting-dashboard.ts:73`

**Resolved (2026-08-30):** replaced the single `Promise.all([...toPromise()])` with three independent `.subscribe()` calls (one per source, matching `ReportingDashboard`'s pattern), each with its own loading flag and error toast; `stats`/`recentTenants`/`chartData` are now `computed()` off per-source signals (`tenants`, `userCount`) so a failing source shows `'—'`/an empty chart in just its own cards instead of blanking the whole page. `.toPromise()` (deprecated in RxJS 7) is gone too.

### Medium: Paginator desyncs from the data after search/filter on three tables

Of ~20 lazy `p-table`s in the app, `employees` and `notifications` never bind `[first]`, and `audit` binds it but never updates it in `onLazyLoad`. A user on page 3 of Employees who searches sees page-1 results while the paginator still highlights page 3; clicking "next" then skips pages 2 and 3 of the new filtered set entirely.

- `frontend/apps/staff-console/src/app/employees/employee-list.html:40`
- `frontend/apps/staff-console/src/app/notifications/notification-list.html:18`
- `frontend/apps/staff-console/src/app/audit/audit-list.ts:63`
- `frontend/apps/staff-console/src/app/audit/audit-list.html:104`

**Resolved (2026-08-30):** bound `[first]="firstRecord()"` on the Employees and Notifications tables, and `onLazyLoad` on Audit now sets `firstRecord` (it previously only tracked `pageSize`).

### Low: Shell chrome ships mock placeholder identity, a hardcoded page title, and inaccessible dropdowns

(1) The user menu falls back to literal mock strings `'Admin User'`/`'admin@medicare.os'` when JWT claims are absent. (2) `userInitials` derives from `roles[0]`, not the user's name, so every Hospital Admin in a tenant shows the identical avatar. (3) The header title is the hardcoded string `Dashboard` regardless of the active route. (4) The three header dropdowns close only via their own toggle — no outside-click handler, no `Escape`, no `aria-expanded`/`aria-haspopup` — and the notification rows are `<a [href]>` rather than `routerLink`, so an internal notification link triggers a full document navigation that discards the in-memory access token.

- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:54`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:61`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:91`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:153`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.ts:58`

**Resolved (2026-08-30):** replaced the specific fake-looking fallbacks (`'Admin User'`, `'admin@medicare.os'`) with honest neutral text (`'Signed in'`, `'—'`) — these only render when `roles`/`hospitalId` are genuinely absent from the claims, an edge case, not the common path; added `aria-haspopup`/`aria-expanded`/`aria-label` to the notifications and user-menu triggers; notification rows now use `[routerLink]` instead of `<a [href]>`, so clicking an internal notification link navigates in-app instead of triggering a full page reload that discards the in-memory access token.

**Deferred (2026-08-30):** (a) `userInitials` still derives from `roles[0]`, not a real name — the JWT (`AccessTokenClaims`) carries only `sub`/`hospitalId`/`roles`/`permissions`, no display name or email at all, so every admin's initials being identical is a genuine data-availability gap, not a bug in how the frontend reads the claims; fixing it needs a backend/JWT change (embedding a name, or a `/auth/me` endpoint), which is its own decision. (b) The hardcoded "Dashboard" header title is unchanged — no route in `app.routes.ts` carries a `title`, and adding one to every route (plus the chrome's `Router.events` wiring to read it) is exactly the kind of "every future screen must follow this convention" decision this project's own fast-track/heavyweight split reserves for the heavyweight pipeline, not a review-fix pass. (c) Outside-click/`Escape`-to-close on the three header dropdowns is not implemented — no existing dropdown in the app has this pattern to copy; scoping it (a directive? per-dropdown listeners?) is a small design decision worth its own pass across all of them rather than one-off here.

### Low: Dead code and hygiene — orphaned `marketing/` module, stray generator directories, self-defeating purge confirmation

(1) `marketing/` contains only an API service and model — no component, no route, zero references anywhere else in `src/app`. (2) `frontend/apps/staff-console/src/app/apps/staff-console/` is a nested tree of empty directories left over from a generator run against the wrong `cwd`. (3) `TenantDetail.purge()` validates the typed hospital ID client-side and then sends `current.hospitalId` — not the user's typed confirmation string — as the `confirmHospitalId` body field, so the backend's server-side typed-confirmation check for an irreversible schema drop is auto-satisfied by the client and provides no independent protection.

- `frontend/apps/staff-console/src/app/marketing/marketing-api.service.ts:1`
- `frontend/apps/staff-console/src/app/apps/staff-console/`
- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.ts:607`

**Resolved (2026-08-30):** deleted the orphaned `marketing/` module (`marketing-api.service.ts`, `marketing.model.ts` — confirmed zero references anywhere else in `src/app`) and the stray `apps/staff-console/src/app/apps/staff-console/` generator-leftover directory tree (confirmed empty — zero files, `git status` showed nothing tracked under it). `TenantDetail.purge()` now sends `this.purgeTypedId()` (what the user actually typed) instead of `current.hospitalId` (a value the client already had) as the `confirmHospitalId` body field — the two are provably equal by the time the call fires (the client-side check just above requires it), so this has no observable behavior change in the honest-client flow; it's a correctness/hygiene fix so a future loosening of that client-side check doesn't silently make the server-side confirmation check trust-only-the-client too.

### Module group: app-wide accessibility follow-up audit (2026-08-31)

A full sweep of `apps/staff-console/src/app/` for accessibility gaps not already covered by the module-group reviews above (icon-only buttons, unlabeled form fields, color-only signaling, keyboard-unreachable custom controls, PrimeNG directive imports, image alt text, heading hierarchy, dialog focus). Directive-import, image-alt, heading-hierarchy and dialog-focus categories all came back clean app-wide — no findings there.

### Medium: Icon-only buttons/links app-wide have no accessible name

An identical "back" chevron/arrow `p-button` (icon only, `[text]="true"`) repeats across 8 detail screens with no `label`/`ariaLabel` — a screen reader announces "button" with no name on every one. The same gap recurs on row-navigation chevrons in two list screens and two more standalone icon buttons.

- `frontend/apps/staff-console/src/app/patients/patient-detail.html:6`
- `frontend/apps/staff-console/src/app/appointments/appointment-detail.html:3`
- `frontend/apps/staff-console/src/app/triage/triage-detail.html:3`
- `frontend/apps/staff-console/src/app/admissions/admission-detail.html:3`
- `frontend/apps/staff-console/src/app/orders/order-detail.html:5`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-detail/purchase-order-detail.html:3`
- `frontend/apps/staff-console/src/app/inventory/stock-requisition-detail/stock-requisition-detail.html:3`
- `frontend/apps/staff-console/src/app/users/user-detail.html:10`
- `frontend/apps/staff-console/src/app/tenants/tenant-detail/tenant-detail.html:3`
- `frontend/apps/staff-console/src/app/patients/patient-list.html:87`
- `frontend/apps/staff-console/src/app/users/user-list.html:63`
- `frontend/apps/staff-console/src/app/audit/audit-list.html:146`
- `frontend/apps/staff-console/src/app/inventory/purchase-order-list/purchase-order-list.html:188`

**Resolved (2026-08-31):** added a destination-specific `ariaLabel` to each back button (e.g. "Back to appointments", "Back to purchase orders"), matching the pattern lab/radiology/pharmacy detail screens already used. Row-navigation chevrons and the two standalone icon buttons got task-specific labels ("View patient", "View account", "View audit record", "Remove line item").

### Medium: Dialog/filter fields in six modules have no label/control association

The `for`/`id` (or `inputId` for PrimeNG components) pairing already fixed in vitals, encounters, orders, nursing, ot, maternity, vaccination and cssd recurs, unfixed, in six more modules — 27 individual field instances where a bare `<label>` has no `id`/`inputId` counterpart, so a screen reader never announces which field it belongs to on focus.

- `frontend/apps/staff-console/src/app/ssu/ssu-list.html:155,222,245,258,298,342`
- `frontend/apps/staff-console/src/app/fraction/fraction-console.html:106,110,114,136,140`
- `frontend/apps/staff-console/src/app/helpdesk/helpdesk-list.html:100,104,108`
- `frontend/apps/staff-console/src/app/employees/employee-list.html:120,129,138,147,157,166,175,184,193`
- `frontend/apps/staff-console/src/app/payroll/payroll-list.html:121,130,141,150`
- `frontend/apps/staff-console/src/app/accounting/accounting-console.html:70,141,151,156`

**Resolved (2026-08-31):** every cited field now carries a matching `for`/`id` or `label for` / `inputId` pair. The SSU "Patient" picker section (a search box + results list + manual-ID fallback, not a single control) is associated with its primary search input rather than left unlabeled or restructured into a fieldset.

### Medium: Shell's unread-notification dot signals state by color alone, and its mobile backdrop is keyboard-unreachable

The notification dropdown's unread indicator is a bare `<span class="w-2 h-2 bg-blue-500 rounded-full">` with no text or `aria-label` — read vs. unread is color-only. Separately, the mobile sidebar backdrop is a `<div (click)="closeSidebar()">` with no `role`/`tabindex`/keydown handler, unreachable by a keyboard-only user.

- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:107`
- `frontend/apps/staff-console/src/app/shell/shell-chrome.html:8`

**Resolved (2026-08-31):** added a visually-hidden "Unread" `sr-only` span alongside the dot (dot itself marked `aria-hidden`); the backdrop now has `role="button"`, `tabindex="0"`, `aria-label="Close menu"`, and `Enter`/`Space` keydown handlers alongside its existing `(click)`.

### Module group: role-based daily-workflow review — 2026-09-01 (Doctor / Nurse / Receptionist)

Product/UX review of `frontend/apps/staff-console`, walked as a Doctor, Nurse, and Receptionist would actually use it day to day (login → landing screen → core daily task), not a code-correctness pass. Cross-referenced against `PRD.md` §6.1 (role scope) and `mvp-status.md` (claimed backend/frontend completeness). The recurring theme: module coverage is broad and backend-complete almost everywhere, but several screens are missing the one write action the role's daily job actually needs, and several PRD-promised behaviors (ward scoping, queue state) were never implemented.

### High: Billing frontend has no payment/deposit recording UI at all — Receptionist cannot collect payment

**Resolved (2026-09-01):** added a "Record Payment" action to the invoice detail screen (gated on
`billing.manage` and hidden once the invoice is `Paid`/`Cancelled`), an Outstanding-balance figure
alongside Total/Paid, and `InvoicesApiService.recordPayment()` wrapping `POST
/billing/invoices/:id/payments`. The modal supports all six backend payment modes (including
`Deposit`, which requires a source deposit id) and refetches the invoice on success so
paid/status/outstanding reflect immediately. Deposit *creation* (a separate, still-missing
screen) remains out of scope — this closes the payment-collection half of the gap only.

`InvoicesApiService` implements only `list()` and `findOne()`; there is no `create`, `recordPayment`, `recordDeposit`, or `return`/credit-note call anywhere in the frontend, and `InvoiceDetail` renders totals/returns read-only with no "Record Payment" action. The backend fully supports all of this (`InvoicesController`'s `POST /billing/invoices`, `POST /:id/payments`, `POST /:id/returns`, `PATCH /:id/cancel`, plus a separate `DepositsController`), and `mvp-status.md`'s "Done" status for `billing` does not flag that the frontend is view-only. Charges land on an invoice automatically via `ChargeCaptureSubscriber`, but there is no way to close one out with a payment through this UI — the Receptionist role's core front-desk task (PRD §6.1: "Billing (charge capture, deposits)") is blocked.

- `frontend/apps/staff-console/src/app/billing/invoices-api.service.ts`
- `frontend/apps/staff-console/src/app/billing/invoice-detail/invoice-detail.html`
- `backend/code/apps/api/src/billing/invoices.controller.ts`
- `backend/docs/technical-design/mvp-status.md:25`

### High: No appointment "checked-in"/"waiting" state exists — no front-desk queue is structurally possible

**Resolved (2026-09-01):** added `CheckedIn` as a real status — `POST /appointments/:id/check-in`
(Scheduled -> CheckedIn only) plus a "Check In" action on the appointment list row and detail
page, gated on `appointment.manage`. No new screen: the existing appointment list already
defaults to today and is filterable by status, so filtering to `CheckedIn` is the queue view. Also
fixed a correctness bug this surfaced — the doctor-conflict/department-capacity checks matched
only `status: 'Scheduled'`, so checking a patient in would have silently freed their slot for a
double-booking; those checks now match `ACTIVE_APPOINTMENT_STATUSES` (Scheduled/CheckedIn/Completed).
Separately, removed the general edit form's "Status" dropdown, which posted `status` through
`PUT /appointments/:id` but did nothing — the backend's `UpdateAppointmentDto` never had a
`status` field, so the whitelist `ValidationPipe` silently stripped it (already covered by an
existing controller spec, "does not let status be set through the update endpoint" — that test
predates this fix). `Completed`/`NoShow` still have no transition mechanism — out of scope here.

`APPOINTMENT_STATUSES = ['Scheduled', 'Completed', 'NoShow', 'Cancelled']` has no `CheckedIn`/`Waiting`/`InConsultation` value, so there is no way to represent "the patient has arrived and is in the waiting room" as distinct from "has a booked slot." This blocks a token/queue display for reception and blocks a doctor from seeing who is actually present versus who merely has an appointment later. This is a missing enum value, not a missing screen — fixing it requires a status-model change, not just new UI.

- `frontend/apps/staff-console/src/app/appointments/appointment.model.ts:18`

### High: No allergy field exists anywhere in the system — a patient-safety gap for Doctor and Nurse

**Resolved (2026-09-01):** added a free-text `allergies` column to `patients` (tenant migration
`0095-add-patient-allergies.ts`, nullable so it backfills existing tenants cleanly — verified via
`migrate-tenants-backfill.integration-spec.ts` and a real `migrate-tenants` run against the dev
`demo` tenant), plumbed through `CreatePatientDto`/`UpdatePatientDto`/`PatientsService`, and
surfaced on the frontend: a persistent red alert banner at the top of the patient chart (visible
regardless of which tab is open, including while writing a Prescription) plus a Demographics grid
tile, both driven off the same `patient.allergies` field, and an edit field on both the
registration and edit-profile forms. Scope note: this closes the *data capture and visibility*
half of the gap — an active interaction check (blocking/warning when a prescribed drug matches a
recorded allergy) is not implemented; that would need a drug-interaction rule engine, out of scope
here. Also scope note: the Nursing console's `administer()` still has no allergy surfacing, because
it has no patient context to check against at all — that's the separate "no link from Admission to
Nursing tasks/MAR" gap below, not re-solved by this change.

Exhaustive grep for "allerg*" across both `frontend/apps/staff-console` and `backend/code` returns zero hits. There is no allergy capture on the patient record, no allergy banner on the chart, and no check against it when a Doctor writes a prescription (`patient-detail.html`'s Prescriptions tab) or a Nurse administers a dose (`nursing-console.ts`'s MAR `administer()`). For a system positioning itself as an EMR with prescribing and medication administration, this is a safety-critical omission, not a nice-to-have.

- `frontend/apps/staff-console/src/app/patients/patient-detail.html:319-335` (Prescriptions tab, no allergy check)
- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:214-236` (`administer()`, no allergy check)

### High: No link from an Admission to that patient's Nursing tasks/MAR — nurse must hand-copy a UUID between screens

**Resolved (2026-09-01):** added a "Nursing Tasks / MAR" link next to "View Patient" on
`AdmissionDetail`, navigating to `/clinical/nursing?admissionId=...`; `NursingConsole` now reads
that query param (via a `queryParamMap` subscription, not a one-time snapshot — this route's
component instance is reused across a query-params-only navigation) and auto-applies it as the
Tasks/MAR filter on arrival. A nurse no longer has to copy the Admission ID off the admission
screen and paste it into the Nursing console. The ward/bed-board half of the daily-friction
problem (below) is unresolved by this change — that's a separate, still-open finding.

`AdmissionDetail` has no reference into the Nursing module — no "create task" or "view MAR" action from a patient's admission record. `NursingConsole`'s Tasks and MAR tabs are both filtered by a free-text Admission ID field (`admissionIdFilter`), so a nurse caring for a patient must manually copy that patient's Admission ID (a UUID) from the admission screen and paste it into the Nursing console to see their tasks or medication schedule. Combined with the absence of any ward/bed board (below), this is the single biggest daily-friction point for the Nurse role: there is no click-through path from "patient I'm caring for" to "their tasks/MAR."

- `frontend/apps/staff-console/src/app/admissions/admission-detail.ts`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:40` (`admissionIdFilter`)

### High: No ward/bed board — ward and bed are raw UUIDs, and bed transfer is a free-text UUID field

`AdmissionDetail` renders `{{ a.wardId }}` / `{{ a.bedId }}` as literal UUIDs, and the "Transfer Bed" modal is a free-text "Destination Bed ID" input the nurse must type a UUID into — there is no visual ward/bed-occupancy board anywhere ("Ward Supply" is stock inventory, not a clinical occupancy view; `master-data-list.ts` manages wards/beds as an admin CRUD list, not an operational one). A nurse has no way to see "which beds on my ward are free right now" or transfer a patient without already knowing a bed's UUID by heart.

- `frontend/apps/staff-console/src/app/admissions/admission-detail.html:56-61,194-208`
- `frontend/apps/staff-console/src/app/admissions/admission-detail.ts:110-136`

**Resolved (2026-09-01):** added a Ward Board screen (`/admissions/ward-board`, nav-linked next to
"Admissions / ADT") — a ward picker plus a live bed-occupancy grid (Available/Occupied/Maintenance,
each occupied card linking to its admission), backed by `GET /wards`, `GET /wards/:wardId/beds`,
and an enriched `GET /admissions/active?wardId=` that now joins in the occupant's patient name/
number server-side (`AdmissionsService.listActive`) instead of the frontend doing an N+1 lookup.
Defaults to the viewer's own assigned ward when she has one (reusing the `wardId` JWT claim from
the ward-scoping work above), otherwise the first ward. `AdmissionDetail`'s "Transfer Bed" modal's
free-text "Destination Bed ID" is now a ward picker + an available-beds-only picker (defaulting to
the admission's current ward, switchable to any ward); its Details panel now resolves `wardId`/
`bedId` to `wardName`/`bedNumber` via `GET /wards/:id`/`GET /beds/:id` instead of showing raw
UUIDs. Verified live end-to-end: board renders occupancy correctly across two wards, a cross-ward
transfer via the pickers persisted correctly, and the Details panel shows resolved names.

### High: `root-redirect.guard.ts` hardcodes the `/billing/invoices` landing route for every tenant user, locking Doctor/Nurse out on a refresh

**Resolved (2026-09-01):** `rootRedirectGuard` now calls `login.ts`'s `resolveTenantLandingUrl()`
directly (same app, no lib-boundary issue) instead of the hardcoded `TENANT_LANDING_URL`, falling
back to `/login` only for the pre-existing "role has no accessible screens" edge case. Verified
live with a fresh Doctor-role test account: navigating straight to `/` now lands on
`/clinical/patients`, not `/login`. `platformGuard`'s own `TENANT_LANDING_URL` fallback (`@org/auth`,
a tenant user manually browsing into `/platform/*`) was left as-is — the shared lib can't import an
app-level resolver without restructuring, and it's a much rarer path than a plain page refresh;
revisit only if that specific case turns out to matter in practice.

The login screen's role-aware landing logic (`ROLE_LANDING_ROUTES` in `login.ts`) is not reused by the guard that handles the bare `/` path (e.g. a page refresh, or the SPA cold-booting on the root URL while a session already exists) — `auth.guard.ts`'s `TENANT_LANDING_URL` is hardcoded to `/billing/invoices` for every non-platform-admin user. Doctor and Nurse hold no `billing.manage` permission, so `permissionGuard(BILLING_MANAGE)` rejects them and bounces them to `/login` even though their session is valid. The common case (logging in through the form) is unaffected; a refresh or deep-link to `/` is not.

- `frontend/apps/staff-console/src/app/root-redirect.guard.ts:6-15`
- `frontend/libs/auth/src/lib/auth.guard.ts:38`
- `frontend/apps/staff-console/src/app/login/login.ts:26-33` (the logic that should be reused instead)

### High: PRD-promised ward-scoped row-level access for Nurse is not implemented

PRD §6.2 describes fine-grained scoping as part of the design intent — explicitly, "Nurse can only write vitals for patients on their assigned ward." No evidence of ward-assignment-based row scoping exists in the nursing/vitals backend services; once a Nurse holds `vitals.manage`/`nursing.manage`, access is tenant-wide, not restricted to an assigned ward. This is a scope/security gap against the documented design, not just a UX one.

- `backend/docs/technical-design/PRD.md:176` (§6.2, the "Nurse can only write vitals..." example)
- `backend/code/apps/api/src/nursing/nursing.service.ts`
- `backend/code/apps/api/src/clinical/vitals/`

**Resolved (2026-09-01):** added an optional `wardId` to staff accounts (migration
`0096-add-account-ward.ts`), threaded through the JWT into `TenantContextService` exactly like the
existing `patientId` scoping pattern (`AuthContextMiddleware` → `RequestContext` →
`TenantContextMiddleware` → `getWardId()`). `NursingService` (tasks + MAR, both list and action
methods) and `VitalsService` (create/read/update/void/listByPatient) each enforce it per-method: an
account with no `wardId` keeps today's tenant-wide access (product decision — "if no wards are
defined, she can access tenant level"); a ward-assigned account is rejected with `ForbiddenException`
outside her ward. Vitals has no `admissionId` of its own, so it resolves the patient's current
active admission's ward; a ward-assigned nurse recording vitals for a patient with no active
admission at all is denied (product decision, the stricter of the two options, over silently
allowing an unscoped write). Admin assigns/clears the ward via `PATCH /accounts/:id/ward`
(`AccountsService.setWard`, validated against `wards`), exposed on the account detail screen
(`frontend/apps/staff-console/src/app/users/user-detail.ts`). Verified live end-to-end: in-ward
write succeeds, out-of-ward and never-admitted are both denied, and an unassigned nurse retains
tenant-wide access.

### Medium: No role-scoped "today" dashboard for any of the three roles

**Resolved (2026-09-01):** added `/dashboard` with role-conditional widgets (Receptionist: today's
appointments + status counts; Doctor: my schedule today, filtered to my own doctorId; Nurse:
pending/in-progress nursing tasks sorted by due date, each linking into the Nursing console
pre-filtered to its admission). `login.ts`'s `resolveTenantLandingUrl()` now sends all three roles
here instead of their old unfiltered list screens, which stay reachable from the sidebar; a new
"Dashboard" nav link (gated on `appointment.read || nursing.read`) makes it reachable after
navigating away. Verified live for all three roles with real fixture data. The `/reporting`
unreachability for these roles is unaffected by this change — still a separate, open item if it
ever needs addressing (the new dashboard covers the "daily work summary" need directly instead).

Doctor lands on the full patient roster (`/clinical/patients`), Nurse on the full triage list (`/clinical/triage`), Receptionist on the full appointment list (`/clinical/appointments`) — all unfiltered, hospital-wide list/search screens, not a "your day" summary (today's appointments, your pending tasks, unread alerts). The one dashboard-shaped screen in the app (`/reporting`, gated by `reporting.read`) is granted only to Super Admin, Hospital Admin, and Auditor/Compliance in `seed-rbac-catalog.ts` — structurally unreachable by any of these three roles even by direct navigation (the route guard redirects to `/login`, the same failure mode as the root-redirect finding above).

- `frontend/apps/staff-console/src/app/login/login.ts:26-33`
- `backend/code/apps/api/src/rbac/seed-rbac-catalog.ts` (`reporting.read` grants)

### Medium: Doctor/Department filters on Appointments are raw-UUID text inputs, not name pickers

**Partially resolved (2026-09-01):** the Appointments slice is done — all four fields (list
filters + create form) are now searchable name pickers. Doctor needed a new backend endpoint
(`GET /accounts/directory?role=X`, gated on a new `identity.accounts.directory` permission
deliberately separate from admin-only `identity.accounts.manage` — see that commit) since no
endpoint previously let Receptionist/Doctor look up staff names at all; Department reuses the
existing `/departments` list, filtered to `isAppointmentApplicable`. Verified live end-to-end.
**Further resolved (2026-09-01):** the bed-transfer modal's Destination Bed ID is now a ward +
available-beds picker (see the ward/bed board finding above).

**Fully resolved (2026-09-01):** Orders' Patient ID filter (list + New Order form) and Nursing's
Admission ID filter are now server-searched patient pickers (`p-select` + `(onFilter)`, debounced
300ms, matching the Appointments Doctor/Department pickers' UI language). Nursing's picker searches
patients, not admissions directly — a patient can only have one active admission at a time
(backend-enforced), so selecting a patient resolves straight to their current admission via
`GET /admissions?patientId=&status=Admitted`; if none is found the nurse gets a toast instead of a
silently-empty screen. The New Task/Schedule Medication modals' own Admission ID fields, previously
a *second* editable uuid input even though they defaulted from the filter, are now a read-only
resolved patient/ward display — and both "New Task" and "Schedule Medication" only render once an
admission is actually resolved, not just on `canManage`.

Both the appointment list's filters and the create-appointment form bind `doctorId`/`departmentId` to a plain `pInputText`, labeled "Doctor ID"/"Department ID" — a receptionist booking a walk-in has no way to pick "Dr. Sharma, Cardiology" from a list and must already know the doctor's UUID. The same raw-UUID pattern recurs on the Orders list (Patient ID filter), the Nursing console (Admission ID filter), and the bed-transfer modal (Destination Bed ID) — a systemic issue, not isolated to one screen.

- `frontend/apps/staff-console/src/app/appointments/appointment-list.html:26-33,110,114`
- `frontend/apps/staff-console/src/app/orders/order-list.ts:49-50`
- `frontend/apps/staff-console/src/app/nursing/nursing-console.ts:40`

### Medium: Orders list is a dead end when opened outside patient-chart context

`OrderList` requires a `patientId` before it will list anything (`order-list.ts:49`'s comment: "the backend list endpoint requires patientId"). Opened from the patient chart it pre-fills correctly via a query param; opened cold from the nav sidebar, a Doctor sees an empty screen with no prompt beyond a bare Patient ID text field.

- `frontend/apps/staff-console/src/app/orders/order-list.ts:49,65-70,82-93`

**Resolved (2026-09-01):** the backend still genuinely requires `patientId` to list orders
(`OrdersService.list` calls `requireParam(query.patientId, 'patientId')` — a global "all orders"
view isn't a supported query shape, and building one was out of scope here), but the "dead end"
part of this finding was specifically the bare, guidance-free text field — that's now the same
patient search picker built for the UUID-picker finding above, with a clear "Search for a patient
above to load their orders" prompt in the empty state instead of a blank table. Verified live: a
Doctor opening `/clinical/orders` cold from the nav sees a guided picker, not a dead end.

### Medium: No insurance/payer capture at patient registration intake

`CreatePatientDto`/`Patient` have no insurance/payer/policy fields; Insurance exists only as a fully separate module (`insurance/insurance-dashboard`) with no link from patient registration or the front-desk billing flow. A receptionist registering a walk-in has no prompt to capture payer information at the point of intake.

- `frontend/apps/staff-console/src/app/patients/patients-api.service.ts:21-52`
- `frontend/apps/staff-console/src/app/insurance/insurance-dashboard/`

**Resolved (2026-09-01), deliberately not a formal `PatientPolicy` link:** the PRD's role-scope
table puts "Insurance & Claims" under Billing/Accounts Staff, not Receptionist ("Patient,
Appointment/Scheduling, Billing (charge capture, deposits)") — granting Receptionist
`insurance.manage` to create a real `PatientPolicy` (payer, coverage window, sum insured) at
intake would have crossed that boundary, and the `PermissionGuard`/`@RequirePermission` decorator
only supports a single required permission per route (no OR-of-permissions), so a narrower new
permission would've meant a second endpoint or a guard change — more surface than this finding
needs. Instead added two free-text columns directly on `patients`
(`insuranceProvider`/`insurancePolicyNumber`, migration `0097-add-patient-insurance-info.ts`) —
within Receptionist's existing `patients.create`/`patients.update` permissions, no RBAC change at
all. A "Has Insurance?" toggle on the registration modal reveals Provider/Policy Number fields;
the same fields are shown/editable on the patient chart. This is a quick note for Billing to act
on, not the formal policy record — Billing/Accounts Staff still sets that up separately via the
Insurance module using the real `InsurancePayer` catalog and coverage-eligibility logic. Verified
live end-to-end (registration → chart display).

### Medium: No explicit sign-off/lock UI on clinical notes

A clinical note becomes immutable server-side the instant it is saved (actor/lock derived from the JWT), but the UI has no visible draft-vs-signed state and no explicit "Sign & Lock" action — a Doctor can't tell from the screen whether a note is still editable before committing it.

- `backend/code/apps/api/src/clinical/encounters/encounters.service.ts`
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:230-272`

**Resolved (2026-09-01), premise corrected:** the backend model was actually already
Draft/Signed with lock enforcement (`ClinicalNote.status`, `EncountersService.updateNote` rejecting
edits once `'Signed'`) — the gap was purely that no frontend screen exposed a way to sign a note or
showed its status distinctly (`patient-detail.html` hardcoded `severity="info"` for every note
regardless of status; `encounter-list.ts` let a user open the edit form for an already-signed note,
which then 409'd on save with no explanation). Added Draft (amber) vs Signed (green) status tags
and a "Sign & Lock" action (with an irreversibility confirm) to both `patient-detail.html`'s Notes
tab and `encounter-list.ts`'s Clinical Notes tab; also hardened `UpdateNoteDto.status` server-side
(`@IsIn(['Draft','Signed'])`, previously an unvalidated free string). **Bonus fix found en route:**
`encounter-list.ts`'s `EncountersApiService` (a *second*, still-live copy of the service, distinct
from the already-fixed one `patient-detail.ts` uses) still typed
`notesByPatient`/`diagnosesByPatient`/`prescriptionsByPatient` as raw arrays when the backend has
always paginated them — the same bug class as the "Edit Profile dialog does not open" incident
above, this time in the `/clinical/encounters` screen, throwing on `@for` over the resulting
`{data, meta}` object. Verified live end-to-end: created a Draft note, signed it, confirmed the
locked/no-edit state on both screens with zero console errors.

### Medium: No shift-handoff notes feature

Grep for handoff/hand-off across both frontend and backend returns nothing — nurse-to-nurse shift handoff, a core daily ritual on any ward, is entirely unsupported.

**Resolved (2026-09-01):** modeled `ShiftHandoffNote` as a sibling to `NursingTask`/
`MedicationAdministration` in the existing Nursing module (migration `0098`, `nursing.manage`/
`nursing.read` permissions, the same ward-scoping enforcement already built for that module —
`assertWardAccessForAdmissionId`/`scopeToOwnWard`) rather than a new module/permission set. A note
carries an optional shift (Day/Evening/Night), free-text note, and an acknowledge action (409 on
double-acknowledge). Frontend adds a "Shift Handoff" tab to the Nursing console — card list (not a
table, to match `patient-detail.html`'s Notes tab), a New Handoff Note modal, and a `p-paginator`
(not `p-table` lazy-load — see the new Development-Standards.md entry on `PaginatorState` vs
`TableLazyLoadEvent`). Verified live end-to-end: created a Night-shift note, listed it, acknowledged
it, resolved author/acknowledger via the directory resolver, zero console errors.

### Low: Doctor is not granted `fraction.read` despite the Fraction/Incentive module existing in nav

PRD §5.6 frames Fraction & Incentive as covering "doctor incentives," and the module/nav entry exists, but `seed-rbac-catalog.ts` does not grant `fraction.read` to the Doctor role — worth a scope check, though low daily-workflow impact.

- `backend/code/apps/api/src/rbac/seed-rbac-catalog.ts` (Doctor grant list vs. `fraction.read`)

**Resolved (2026-09-01):** granted `fraction.read` (not `fraction.manage` — rule creation/editing
stays HR/Payroll Admin's job) to Doctor. Also fixed a latent bug this exposed: `FractionConsole`
rendered New Rule/Record Share/Deactivate unconditionally with no permission gate, so a Doctor
with read-only access would have seen buttons that always 403 on click — added `canManage`
(`fraction.manage`) gating matching the established `ssu-list.ts` pattern (hide the mutating
controls, show "View only" per row). Verified live: `dr.test` reaches `/fraction`, sees rules with
resolved doctor names (via the directory resolver) and no mutating controls.

### High: Patient "Edit Profile" dialog does not open — discovered 2026-09-01, unrelated to the allergies work in progress at the time

**Resolved (2026-09-01) — turned out to be page-wide, not dialog-specific:** root cause was
`EncountersApiService.getNotesByPatient/getDiagnosesByPatient/getPrescriptionsByPatient` being
typed and consumed as a raw array when the backend has always returned the paginated
`{ data, meta }` shape (matching every other patient-chart tab). `loadNotes()` stored the whole
response object into the `notes` signal, so `pagedNotes()`'s `.slice()` call threw on every load —
an uncaught exception inside a `computed()`, evaluated during Angular's change-detection pass,
which aborted rendering for the *entire* page. That's why **every** `p-dialog` on the route failed
to open, including the app shell's completely unrelated "Change Password" dialog — not a
`p-dialog`/`showEditModal` issue at all, that was a wrong lead in the paragraph below. Fixed by
correcting the three methods' types and extracting `.data` in the loaders (full write-up in the fix
commit). The existing test suite had a matching test-double bug — mocks returned raw arrays,
which is why 517 green tests never caught this — also fixed.

Original (partially incorrect) write-up, kept for the record: While live-verifying the
allergy-field feature (below), the "Edit Profile" button on the patient chart was found to do
nothing when clicked: `PatientDetail.openEditModal()`'s unit tests pass (they call the method
directly and assert on `editForm`/`showEditModal` signals), but driving the actual button click in
a running browser produces zero `.p-dialog` elements and the underlying `#editFirstName` input
never appears — confirmed on completely unmodified `git stash`-clean code, so this is pre-existing
and unrelated to the allergies change. Root cause not yet isolated (not a console error — zero JS
exceptions accompany the failed click); candidates include a PrimeNG `p-dialog` rendering/animation
issue specific to this dialog instance, or something about how `showEditModal`'s two-way binding
interacts with this component's change-detection. Whatever the cause, a receptionist or admin
currently has no working UI path to correct a patient's demographics after registration (API-level
PATCH still works, confirmed via curl). Needs dedicated triage.

- `frontend/apps/staff-console/src/app/patients/patient-detail.ts` (`openEditModal`, `showEditModal`)
- `frontend/apps/staff-console/src/app/patients/patient-detail.html:458` (`Edit Profile` `p-dialog`)

### Medium: patientId/doctorId/wardId/bedId shown as raw UUIDs across most of the app, not just Admissions

The "ward and bed are raw UUIDs" and "Doctor/Department filters... raw-UUID" findings above only
covered Admissions and Appointments — a broader sweep (prompted directly by the user after the
Ward Board work) found the same raw-uuid-as-display pattern on Billing invoices, Fraction/
Incentive (doctorId), Insurance (patientId on policies and claims), Maternity (patientId,
admissionId), Orders (detail + list: patientId, orderedBy), OT (patientId), and Vaccination
(patientId) — nine more screens with the same shape of problem, not isolated to Admissions.

**Resolved (2026-09-01):** rather than repeat the per-endpoint join pattern (§112) nine more times,
added a shared `POST /directory/resolve` bulk lookup (`backend/code/apps/api/src/directory/`) and
a frontend `<hms-entity-name [type]="'patient'|'doctor'|'ward'|'bed'" [id]="...">` component
(`frontend/apps/staff-console/src/app/directory/`) backed by a batching+caching resolver service,
then swept it across all nine screens plus the two Admissions fields (Patient ID, Admitting Doctor
ID) the earlier ward/bed fix didn't reach. Every occurrence now shows the name with the id in small
muted text beside it, rather than replacing the id outright. See `Development-Standards.md` §113
for the pattern — use it for any new screen carrying one of these ids instead of adding another
per-endpoint join. Maternity's `admissionId` column became a link to the admission instead (not a
name — an admission has no "name" concept). Verified live end-to-end (Admissions list/detail,
Insurance policies) with real data.

### High: Patient registration/edit 400s whenever Date of Birth, Phone, or Email is left/cleared blank — discovered 2026-09-01 while verifying the family-shared-phone scenario

While live-verifying that multiple family members can share one phone number (a common India
pattern — parents registering children under one contact number), registering a second patient
with a blank Date of Birth 400'd. Root cause: `CreatePatientDto`/`UpdatePatientDto`'s `@IsOptional()`
only skips validation when a field is `undefined`/`null`, not `''` — the format validators on
`dateOfBirth`/`phoneNumber`/`email` (`@IsDateString`, `@Matches`, `@IsEmail`) still run against an
empty string and reject it. `patient-list.ts`'s registration form defaults these fields to `''`
(not `undefined`), and `patient-detail.ts`'s edit form carries an empty string forward if a
previously-filled field is cleared — both sent the raw `''` straight to the API, so any
registration/edit that left one of these three fields blank failed with a 400.

**Resolved (2026-09-01):** `submitRegistration()`/`checkAndSubmit()` (`patient-list.ts`) and
`submitEdit()` (`patient-detail.ts`) now coerce `dateOfBirth`/`phoneNumber`/`email` to `undefined`
when blank before sending. Added regression tests asserting the payload omits these fields when
empty, and confirming the underlying family-shared-phone scenario itself: `checkDuplicates` on a
shared phone number returns the existing family member as a non-blocking warning (name +
patientNo shown so staff can see it's a different person), "Register as New Patient Anyway"
proceeds, and a phone-number search on the Patient Master Index returns every family member as
distinct, separately-selectable rows. Verified live end-to-end (two patients, same phone number,
different names) with zero console errors — screenshots in the fix commit's session log.

- `frontend/apps/staff-console/src/app/patients/patient-list.ts` (`submitRegistration`, `checkAndSubmit`)
- `frontend/apps/staff-console/src/app/patients/patient-detail.ts` (`submitEdit`)

### Medium: Two more live instances of the blank-optional-field 400 (§ above) — Employee email, Maternity EDD

User asked whether the Patient blank-field bug was likely to exist elsewhere. Audited every
`*.dto.ts` under `backend/code/apps/api/src` (~140 `@IsOptional()` fields paired with a
format-strict validator) against every frontend form that populates the matching field. Most of
the codebase already guards this correctly (`ward-supply-console.ts`, `purchase-order-detail.ts`,
`ot-list.ts`, `nursing-console.ts`, `user-detail.ts`, `ssu-list.ts`, `accounting-console.ts` all
coerce `field || undefined` before sending, and most numeric fields use `p-inputNumber`, which
emits `null` on clear, not `''`). Two live instances survived the filter:

- `email` on `employee/dto/employee.dto.ts` (`CreateEmployeeDto`/`UpdateEmployeeDto`, `@IsOptional()
@IsEmail()`) — `employee-list.ts`'s `submitSave()` sent it unguarded.
- `edd` on `maternity/dto/create-maternity-record.dto.ts` (`@IsOptional() @IsDateString()`) —
  `maternity-list.ts`'s `submitCreate()` sent it unguarded.

**Resolved (2026-09-01):** same fix as the Patient module — coerce to `undefined` at submit time
(`email: form.email || undefined` in `employee-list.ts`, `edd: form.edd || undefined` in
`maternity-list.ts`), regression test per field asserting the payload omits it when blank. Verified
live: created an Employee with email typed then cleared, and a Maternity record with EDD picked
then cleared, both saved with zero 400s.

Everything else checked (DTO field with the risky decorator shape but no live path to `''`, listed
for completeness): `appointments` `contactNumber`/`message`/`doctorId`/`departmentId`/`patientId`
(no frontend edit control reaches them), `insurance` `copayPercent` (bound to `p-inputNumber`),
`ward-supply`/`inventory` `expiryDate` (already guarded), `master-data`/`rbac` numeric fields
(coerced via `+$event`), `accounts` `assign-role` `startDate`/`endDate` (already guarded),
`employee.dto.ts` `departmentId` (`p-select`, no blank option), and a long tail of DTOs
(`marketing`, `rbac`, `directory`, `tenants`, `platform-billing`, `platform-branding`,
`admissions`/`orders` source-reference fields, `lab`/`radiology`/`inventory` catalog fields) with
no frontend create/edit UI wired up yet at all.

- `frontend/apps/staff-console/src/app/employees/employee-list.ts` (`submitSave`)
- `frontend/apps/staff-console/src/app/maternity/maternity-list.ts` (`submitCreate`)

### High: Admissions' own New Admission dialog was never included in the raw-UUID picker sweep

Found live during QA testing (2026-09-01): the earlier "raw patient/admission UUID" picker sweep
(§ above, OT/Maternity/Vaccination/Orders/Nursing/SSU) never actually touched Admissions' own
`admission-list.ts` — the New Admission dialog's Patient ID, Admitting Doctor ID, and Bed ID were
still raw-UUID text fields, and the list's own Ward/Patient filters were too, even though every
other module was swept. Ironic given Admissions is the module the "Ward/Bed Board" and
bed-transfer-picker work (§112/§113) originated from — that work touched `admission-detail.ts`'s
transfer flow, never `admission-list.ts`'s create flow.

**Resolved (2026-09-01):** Patient — server-searched `p-select`, matching Orders/Nursing/OT/
Maternity/Vaccination/SSU. Admitting Doctor — bulk-loaded picker via
`UsersApiService.listDirectory('Doctor')`, matching Appointments. Ward+Bed — a cascading picker
(pick a ward, then an available bed in it), reusing the exact shape of
`admission-detail.ts`'s existing transfer-ward flow rather than inventing a new pattern. List
filters: Ward is now a bulk-loaded picker, Patient a search picker. Not live-verified locally at the
time (the dev Postgres port was held by an unrelated project's container); covered by clean
typecheck and 6 new/updated tests. **Verified live on QA (2026-09-01)** after redeploy — see the
RBAC finding immediately below for the one follow-up issue that surfaced during that verification.

- `frontend/apps/staff-console/src/app/admissions/admission-list.ts`
- `frontend/apps/staff-console/src/app/admissions/admission-list.html`

### Low: Vitals/Encounters "Find patient" panel shows a stale "No patients matched" message after selection

Found live during QA testing (2026-09-01): both standalone screens' `selectPatient()` cleared
`patientResults` on selection but left `searchQuery` set, so the template's `@else if
(searchQuery().trim() && !searching())` branch kept rendering `No patients matched "<query>"`
underneath the now-loaded patient panel. Cosmetic only — the correct patient still loaded — but
reproduced consistently under both an admin and a clinical-role login.

**Resolved (2026-09-01):** `selectPatient()` now also clears `searchQuery` in both components.
Covered by an assertion added to each screen's existing "selects a patient" test; full suite (596
tests) and a clean `tsc --build` pass. **Verified live on QA (2026-09-01)** after redeploy — the
search box clears and the stale message no longer renders on either screen.

- `frontend/apps/staff-console/src/app/vitals/vital-list.ts`
- `frontend/apps/staff-console/src/app/encounters/encounter-list.ts`

### High: `identity.accounts.directory` RBAC grant never reached QA's already-provisioned tenant

Found live during QA testing (2026-09-01), immediately after the Admissions picker fix above shipped:
the Admitting Doctor picker's `usersApi.listDirectory('Doctor')` call 403'd for `demoadmin`
(Hospital Admin role) on QA. `seed-rbac-catalog.ts` does grant `identity.accounts.directory` to
Hospital Admin (added in `cdfe902`, "add a staff directory endpoint for name-picker UIs" — the same
commit that introduced the directory endpoint the whole picker sweep depends on), but that grant
only reaches a tenant's `role_permissions` table when the RBAC seed is actually re-run against it.
QA's demo tenant was provisioned before `cdfe902` and was never re-seeded, so its Hospital Admin
role was still missing the grant even though the code (and a fresh tenant) would have it correctly.
Not a code bug — an operational gap: RBAC catalog changes need a re-seed step called out explicitly
as part of shipping any commit that touches `seed-rbac-catalog.ts`'s `ROLE_PERMISSION_MAPPINGS`.

**Resolved (2026-09-01):** re-ran the RBAC seed against QA
(`docker compose -f docker-compose.prod.yml --profile seed run --rm seed-rbac`, safe/idempotent —
`seedRbacCatalog` upserts, doesn't truncate). Verified live: the doctor picker on both Admissions
and Appointments now populates correctly with zero 403s.

- `backend/code/apps/api/src/rbac/seed-rbac-catalog.ts`

### High: Invoices' patient filter was a raw-UUID text field, missed by the earlier picker sweep

Found live during QA testing (2026-09-01) while working through the financial modules not yet
covered by this pass: `/billing/invoices` never got the server-searched patient picker the
clinical/operations screens received — it was a bare `pInputText` requiring the patient's raw UUID
typed or pasted by hand, unlike its own table body which already resolves via
`<hms-entity-name type="patient">`. Same class of gap as the Admissions finding above — the sweep's
module list never included Billing.

**Resolved (2026-09-01):** replaced with the same server-searched `p-select` pattern (debounced
`onPatientFilterSearch`, `PatientsApiService.search`) used everywhere else. Covered by a new
debounce test; full suite (597 tests) and a clean `tsc --build` pass. Not yet live-verified on QA —
pending redeploy.

- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.ts`
- `frontend/apps/staff-console/src/app/billing/invoice-list/invoice-list.html`

### Low: Payroll's Year fields render with a thousands separator ("2,026")

Found live during QA testing (2026-09-01) while verifying the earlier journal-balance and
confirmation-dialog fixes: both Payroll `p-inputNumber` Year fields (the list filter bar and the
Run Monthly Payroll dialog) default to PrimeNG's `useGrouping: true`, so a 4-digit year displays
with a locale thousands separator — "2,026" instead of "2026". Cosmetic only, the bound value was
never actually a formatted string, but reads as wrong/unprofessional on every payroll run.

**Resolved (2026-09-01):** added `[useGrouping]="false"` to both. Checked the rest of the app for
the same pattern — `fixed-assets-console.html`'s "Useful Life (years)" field is a small duration
count, not a calendar year, so it doesn't trigger the same visual bug and was left alone.

- `frontend/apps/staff-console/src/app/payroll/payroll-list.html`

## Open Question

Are these documents meant to describe the implemented state today, or the intended target architecture? If they are target-state documents, the deployment guide and runbook still need to remain current-state accurate because operators and contributors will follow them literally.
