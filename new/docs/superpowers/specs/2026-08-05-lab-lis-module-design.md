# Lab/LIS Module — Core Clinical Pipeline — Design Spec

**Source:** `pending-tasks.md` Phase 6 product module backlog, Phase 2 group (PRD §5.3): Lab/LIS,
first of the six Phase 2 domains, chosen as first since it's listed first in the PRD's own
ordering and has the largest `old/` reference footprint of the group.

## Problem

The PRD describes Lab/LIS as: "Test catalog, sample tracking, results, lab report export." No
Lab-specific code exists in `apps/api` today. The existing `Order`/`OrderItem` entities already
route to Lab (`OrderItem.itemType === 'Lab'`), but `itemDescription` is free text with no
reference to any test catalog — Lab needs a structured catalog (test → component sub-results,
reference ranges) that today's `Order` module has no concept of.

The old system's full Lab/LIS domain (`old/hospital-management-emr/.../LabModels`, `LISModels`,
`Controllers/Lab`) is large: test catalog hierarchy, barcode/accession sample tracking, per-
component result entry, configurable multi-level verification, HTML-template PDF report
generation, machine/instrument (LIS) integration, external lab send-out, and government
disease-reporting mapping. Building all of it in one pass isn't tractable — this spec scopes the
first, foundational slice.

## Scope

**In scope (this spec):**
- Test catalog: Category → Test → Component (component = one named result row within a test,
  e.g. "Hemoglobin" within "CBC"), each with a reference range.
- Requisition: the accessioned instance of one ordered test, linked to the existing `OrderItem`
  and to the catalog `LabTest` it was reclassified against, with a generated requisition number.
- Sample tracking: specimen type, sample-collected timestamp.
- Result entry: one value per component per requisition.
- Verification: a single sign-off step (no multi-level, no preliminary-report toggle).

**Explicitly deferred (not in this spec, each a separate future item):**
- Report generation/PDF export — the old system's HTML-template-driven PDF layer
  (`LabReportModel`, `LabReportTemplateModel`) needs its own design once this pipeline exists to
  read from.
- Machine/instrument (LIS) integration — `LISComponentMapModel`'s machine-to-catalog component
  mapping; no analyzer integration exists to design against yet.
- External lab send-out — `LabRequisitionModel`'s `ResultingVendorId`/`ExternalLabSampleStatus`
  fields; no stated need yet.
- Government disease-reporting mapping — the old system's `LabGovReportMappingModel`; this
  belongs to the Reporting/Dashboard domain's export work (`pending-tasks.md` Phase 4 item 10's
  deferred export-endpoints scope), not Lab itself.
- Auto-calculated derived components (e.g. MCH/MCHC computed from raw values) — YAGNI until a
  real catalog test needs it.
- Multi-level verification / preliminary-report text — the old system gated this behind a
  per-deployment config toggle (`VerificationCoreCFGModel`); no stated need for that
  configurability yet, so this spec hard-codes single-level.

## Architecture

New domain module `apps/api/src/lab/`, following the existing module shape (`admissions/`,
`orders/`): `lab.module.ts`, `entities/*.entity.ts`, `lab-catalog.service.ts` (catalog CRUD),
`lab-workflow.service.ts` (requisition/result/verify actions), `lab-catalog.controller.ts`,
`lab-workflow.controller.ts`, DTOs. Two controllers/services rather than one, splitting
catalog-management (infrequent, admin-only) from day-to-day workflow (frequent, Lab Technician) —
mirrors the RBAC split below and keeps each file focused on one responsibility.

All tenant-scoped, using the existing `TenantConnectionService.runInTenantSchema()` pattern —
no entity carries a `tenantId` column; isolation is Postgres schema/search_path-level, exactly as
every other domain module in this codebase.

## Entities

```ts
// entities/lab-test-category.entity.ts
@Entity('lab_test_categories')
export class LabTestCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/lab-test.entity.ts
@Entity('lab_tests')
export class LabTest {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'varchar' }) specimenType!: string; // e.g. 'Blood', 'Urine'
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/lab-test-component.entity.ts
@Entity('lab_test_components')
export class LabTestComponent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) testId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) unit!: string | null;
  @Column({ type: 'numeric', nullable: true }) referenceRangeLow!: string | null;
  @Column({ type: 'numeric', nullable: true }) referenceRangeHigh!: string | null;
  @Column({ type: 'varchar', nullable: true }) referenceRangeText!: string | null; // e.g. 'Negative'
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/lab-requisition.entity.ts
@Entity('lab_requisitions')
export class LabRequisition {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderItemId!: string;
  @Column({ type: 'uuid' }) testId!: string;
  @Column({ type: 'varchar', unique: true }) requisitionNumber!: string;
  @Column({ type: 'varchar' }) specimenType!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'SampleCollected' | 'ResultsEntered' | 'Verified' | 'Cancelled'
  @Column({ type: 'uuid', nullable: true }) sampleCollectedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) sampleCollectedAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) verifiedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/lab-result.entity.ts
@Entity('lab_results')
export class LabResult {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) requisitionId!: string;
  @Column({ type: 'uuid' }) componentId!: string;
  @Column({ type: 'varchar' }) value!: string; // numeric or qualitative ('Positive'/'Negative')
  @Column({ type: 'boolean', default: false }) isAbnormal!: boolean;
  @Column({ type: 'uuid' }) enteredBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) enteredAt!: Date;
}
```

`requisitionNumber` is generated by a `LabRequisitionNumberGeneratorService`, copying
`PatientNumberGeneratorService`'s atomic-sequence pattern verbatim (a `lab_requisition_sequences`
table with the same `(prefix, year) → lastSequence` shape, `INSERT ... ON CONFLICT DO UPDATE
... RETURNING`).

## Data Flow

1. Doctor places a Lab order exactly as today — `OrderItem` with `itemType='Lab'`, free-text
   `itemDescription`. **No change to the `Order`/`OrderItem` entities or the Orders module.**
2. A Lab Technician creates a `LabRequisition`, supplying the `orderItemId` and the catalog
   `testId` they've matched it to (the reclassification step — the free-text order becomes a
   structured catalog reference). This mints `requisitionNumber` and starts at `status: 'Pending'`.
   Creating a requisition for an `orderItemId` that isn't `itemType='Lab'`, or that already has a
   non-cancelled requisition, is rejected (`BadRequestException`/`ConflictException`).
3. Marking the sample collected (`sampleCollectedBy`/`At` stamped) moves `status` to
   `'SampleCollected'`. Only valid from `'Pending'`.
4. Entering a `LabResult` row for each of the test's components (per `LabTestComponent` rows for
   that `testId`) is allowed from `'SampleCollected'` onward. Once every component for the test
   has a `LabResult` row, the requisition auto-advances to `'ResultsEntered'`. Re-entering a result
   for a component that already has one **overwrites** the existing `LabResult` row (upsert on
   `requisitionId`+`componentId`) as long as the requisition isn't yet `'Verified'` — lets a tech
   correct a data-entry mistake before sign-off. Once `'Verified'`, `enterResult` is rejected
   (`ConflictException`) — verification is meant to lock the result set it signs off on.
5. Verifying (any Lab Technician — no four-eyes enforcement, per your earlier call) stamps
   `verifiedBy`/`verifiedAt` and moves `status` to `'Verified'`. Only valid from
   `'ResultsEntered'`.
6. A requisition can be cancelled (`cancelReason` stamped, `status: 'Cancelled'`) from any
   non-terminal state (`'Pending'`, `'SampleCollected'`, `'ResultsEntered'`) — not from
   `'Verified'`, matching `OrderItem`'s one-shot terminal-transition pattern.

## RBAC

Mirrors `master-data.manage`'s existing coarse-catalog / fine-operational split:

| Permission | Grant to | Covers |
|---|---|---|
| `lab.manage_catalog` | Hospital Admin, Super Admin | CRUD on categories/tests/components |
| `lab.read` | Lab Technician, Doctor | View catalog, requisitions, results |
| `lab.create_requisition` | Lab Technician | Create a requisition from an OrderItem |
| `lab.enter_results` | Lab Technician | Collect sample, enter component results |
| `lab.verify_results` | Lab Technician | Verify a fully-resulted requisition |

Doctor gets `lab.read` per the PRD's stated cross-role visibility ("Doctor: ... Lab, Radiology,
Pharmacy (results/status)"). `Lab Technician` role already exists in `seed-rbac-catalog.ts` with
zero permissions — this item is its first-ever permission grant, the same situation
`reporting.read` was for `Auditor/Compliance` in Phase 4 item 10.

## Error Handling

Same defensive status-guard pattern as `OrderItem`'s `completeItem`/`cancelItem`: each workflow
action (`createRequisition`, `collectSample`, `enterResult`, `verify`, `cancel`) checks the
requisition's current `status` and throws `ConflictException` if the transition isn't valid from
that state. `enterResult` additionally validates `componentId` belongs to the requisition's
`testId` (`BadRequestException` otherwise).

## Testing

No automated tests this pass (standing project instruction) — manual verification: seed a test
category/test/component set directly via the catalog service, place an Order with a Lab
`OrderItem`, walk it through requisition → sample collected → result entry (all components) →
verify, confirming each status transition and rejection of invalid transitions (e.g. verifying a
`'Pending'` requisition should throw), via a scratch script against a live tenant schema — same
style as this session's prior items' manual verification.

## Documentation Updates

- `Development-Standards.md`: new section documenting the catalog/requisition/result/verify
  pattern and the RBAC split.
- `pending-tasks.md`: Phase 6's Phase 2 group gets its first sub-item marked, noting Lab/LIS core
  pipeline done and the four deferred pieces (report export, machine integration, external
  send-out, gov reporting) named explicitly as future items.
