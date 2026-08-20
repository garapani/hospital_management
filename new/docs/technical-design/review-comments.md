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
for this item is still outstanding.

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

## Open Question

Are these documents meant to describe the implemented state today, or the intended target architecture? If they are target-state documents, the deployment guide and runbook still need to remain current-state accurate because operators and contributors will follow them literally.
