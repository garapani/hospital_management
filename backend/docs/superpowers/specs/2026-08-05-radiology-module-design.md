# Radiology Module — Core Clinical Pipeline — Design Spec

**Source:** `pending-tasks.md` Phase 6 product module backlog, Phase 2 group (PRD §5.3): Radiology,
second of the six Phase 2 domains (Lab/LIS shipped first). Chosen next per the PRD's own listed
order and because it shares Lab/LIS's just-proven shape: an order-routed diagnostic module.

## Problem

The PRD describes Radiology as: "Imaging orders, report generation." No Radiology-specific code
exists in `apps/api` today. The existing `Order`/`OrderItem` entities already route to Radiology
(`OrderItem.itemType === 'Radiology'`), the same untouched mechanism Lab/LIS used.

Investigation of the old system's `RadiologyModels/` (`old/hospital-management-emr/Code/
Components/DanpheEMR.ServerModel/RadiologyModels/`) found a domain shape simpler than Lab's:

- **Two-level catalog** (`RadiologyImagingTypeModel` → `RadiologyImagingItemModel`, e.g. Type
  "X-Ray" → Item "Chest X-Ray PA View"), not Lab's three-level Category→Test→Component — an
  imaging study produces one narrative report, not per-component numeric results.
- **A flat requisition** (`ImagingRequisitionModel`) with scan-step fields (`IsScanned`/
  `ScannedBy`/`ScannedOn`) distinct from report fields.
- **A single narrative report field** (`ImagingReportModel.ReportText`), not a results table.
- **No real sign-off step** — `ReportingDoctorModel` is dead, commented-out code in the old
  system; verification was never actually finished, just a free-text `Signatories` string.
- **DICOM concepts are entirely separate** — `DICOMModels/` (SOP/series/study UIDs) is its own
  folder with its own controller (`DicomViewer/DicomController.cs`), confirming DICOM is a
  distinct, not-yet-built module and stays out of this spec's scope.
- **Image attachments** (`ImageAttachmentModel`) are plain base64 blobs — a clean future match for
  `@hospital/object-storage`, but that module has zero real consumers today and this spec
  deliberately doesn't make it the first one.
- **Film type/quantity** (`FilmTypeModel`) is a billing-consumable concept with no clinical
  meaning and no current Billing-side consumer.

## Scope

**In scope (this spec):**
- Imaging catalog: Type → Item (two levels, no sub-components).
- Requisition: linked to the existing `OrderItem`, reclassified against the catalog `Item` a
  Radiology Technician matches it to (same reclassification pattern Lab/LIS established).
- Scan tracking: who/when the study was performed.
- Report entry: one narrative text field per requisition (not per-component, unlike Lab).
- Verification: a single sign-off step — **a deliberate improvement over the old system**, which
  never actually finished this (dead `ReportingDoctorModel`, just a free-text signatories field).
  Mirrors Lab/LIS's now-proven single-level verification pattern.

**Explicitly deferred (not in this spec, each a separate future item):**
- Image attachment / `@hospital/object-storage` integration — deferred so that module gets a
  focused first consumer designed on its own terms, not bolted on here.
- Film type/quantity billing-consumable tracking — no current Billing-side consumer to design
  against; purely bookkeeping, not clinical.
- DICOM integration — confirmed a wholly separate old-system domain (own models, own controller);
  not Radiology's concern.
- Report template HTML rendering / PDF export — same class of deferral as Lab/LIS's report-export
  item.
- Multi-level verification, four-eyes enforcement — same reasoning as Lab/LIS: no stated need.

## Architecture

New domain module `apps/api/src/radiology/`, mirroring `apps/api/src/lab/`'s two-controller split:
`RadiologyCatalogService`/`RadiologyCatalogController` (type/item catalog, admin-gated) and
`RadiologyWorkflowService`/`RadiologyWorkflowController` (requisition/scan/report/verify actions).
All tenant-scoped via `TenantConnectionService.runInTenantSchema()`.

**Structural simplification vs. Lab:** because a radiology study produces exactly one report (not
N per-component results), there is **no separate report table**. Report fields (`reportText`,
`indication`, `performerId`, `reportEnteredBy`/`At`) live directly on `RadiologyRequisition`.
This avoids Lab's `ON CONFLICT` upsert-with-unique-constraint machinery entirely — report entry
is an ordinary `UPDATE` guarded by the requisition's own status, and there is no "have all
components been resulted yet" coverage check to get wrong (the single field that just moves the
requisition to `'ReportEntered'` is written atomically in the same statement).

## Entities

```ts
// entities/radiology-imaging-type.entity.ts
@Entity('radiology_imaging_types')
export class RadiologyImagingType {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) procedureCoding!: string | null;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/radiology-imaging-item.entity.ts
@Entity('radiology_imaging_items')
export class RadiologyImagingItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) imagingTypeId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) procedureCode!: string | null;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/radiology-requisition.entity.ts
@Entity('radiology_requisitions')
export class RadiologyRequisition {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderItemId!: string;
  @Column({ type: 'uuid' }) imagingItemId!: string;
  @Column({ type: 'varchar', unique: true }) requisitionNumber!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'Scanned' | 'ReportEntered' | 'Verified' | 'Cancelled'
  @Column({ type: 'uuid', nullable: true }) scannedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) scannedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) reportText!: string | null;
  @Column({ type: 'text', nullable: true }) indication!: string | null;
  @Column({ type: 'uuid', nullable: true }) performerId!: string | null;
  @Column({ type: 'uuid', nullable: true }) reportEnteredBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reportEnteredAt!: Date | null;
  @Column({ type: 'uuid', nullable: true }) verifiedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) verifiedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`requisitionNumber` is generated by `RadiologyRequisitionNumberGeneratorService`, copying the same
atomic-sequence pattern used for both `PatientNumberGeneratorService` and Lab's
`LabRequisitionNumberGeneratorService` (a `radiology_requisition_sequences` table, `(prefix,
year) → lastSequence`, prefix `'RAD'`).

## Data Flow

1. Doctor places a Radiology order exactly as today — `OrderItem` with `itemType='Radiology'`,
   free-text `itemDescription`. **No change to `Order`/`OrderItem` or the Orders module.**
2. A Radiology Technician creates a `RadiologyRequisition`, supplying `orderItemId` and the
   catalog `imagingItemId` they've matched it to. Mints `requisitionNumber`, starts `'Pending'`.
   Rejected (`BadRequestException`) if the `OrderItem` isn't `itemType='Radiology'` or is already
   `'Cancelled'`; rejected (`ConflictException`) if a non-cancelled requisition already exists for
   that `orderItemId`.
3. Marking scanned (`scannedBy`/`At` stamped) moves `'Pending'` → `'Scanned'`.
4. Entering the report (`reportText`, optional `indication`/`performerId`, `reportEnteredBy`/`At`
   stamped) moves `'Scanned'` → `'ReportEntered'`. Re-entering before verification **overwrites**
   the same fields (an ordinary `UPDATE`, not an upsert — there's only one row to begin with).
   Once `'Verified'`, report entry is rejected (`ConflictException`) — same locking rule as Lab.
5. Verifying (`verifiedBy`/`At` stamped, no four-eyes enforcement — same call as Lab) moves
   `'ReportEntered'` → `'Verified'`.
6. Cancellable (`cancelReason` stamped) from any non-terminal state (`'Pending'`, `'Scanned'`,
   `'ReportEntered'`), not from `'Verified'`.

## Correctness — applied from the start, not as a follow-up fix

Lab/LIS's final whole-branch review found several concurrency/correctness gaps that were fixed
*after* the fact. This spec bakes the same fixes in from the start:

- The existing-requisition check in `createRequisition` filters `status != 'Cancelled'`
  (TypeORM `Not('Cancelled')`), and the initial migration includes a partial unique index
  (`CREATE UNIQUE INDEX ... ON radiology_requisitions ("orderItemId") WHERE status <> 'Cancelled'`)
  from day one — not added in a later fix-up migration.
- `RadiologyRequisitionNumberGeneratorService.generateNextRequisitionNumber()` is called *before*
  `createRequisition` opens its own `runInTenantSchema()`, never nested inside it (mirrors
  `PatientsService.create`'s existing pattern).
- Every status-transition mutator (`markScanned`, `enterReport`, `verify`, `cancel`) takes a
  `pessimistic_write` lock on its initial requisition lookup, before checking/mutating status.
- `createRequisition` rejects a cancelled `OrderItem` immediately (`BadRequestException`), the
  same fix Lab/LIS needed after its final review.
- A `23505` unique-violation on `createRequisition`'s save is caught and translated to
  `ConflictException` — scoped by checking the actual constraint name (`error.driverError
  ?.constraint === 'UQ_radiology_requisitions_active_order_item'`) rather than a bare error-code
  check, avoiding Lab's parked residual gap (a bare `code === '23505'` check would also catch an
  unrelated `requisitionNumber` collision and mislabel it).

## RBAC

Mirrors Lab/LIS's shape exactly, nouns swapped:

| Permission | Grant to | Covers |
|---|---|---|
| `radiology.catalog.manage` | Hospital Admin, Super Admin | Create/list imaging types/items (create+list only, matching Lab's corrected scope — no update/delete) |
| `radiology.read` | Radiology Technician, Doctor | View catalog, requisitions, reports |
| `radiology.requisition.create` | Radiology Technician | Create a requisition from an OrderItem; also gates `cancel` (same permission-reuse choice Lab made) |
| `radiology.report.enter` | Radiology Technician | Mark scanned, enter report text |
| `radiology.report.verify` | Radiology Technician | Verify a fully-reported requisition |

`Radiology Technician` role already exists in `seed-rbac-catalog.ts` with zero permissions — this
item is its first-ever grant, the same starting point Lab Technician was in.

## Error Handling

Same defensive status-guard pattern as Lab: each workflow action checks the requisition's current
`status` and throws `ConflictException` if the transition isn't valid from that state.

## Testing

No automated tests this pass (standing project instruction) — manual verification: seed an
imaging type/item, place an Order with a Radiology `OrderItem`, walk it through requisition →
scanned → report entered → verify, confirming each transition and rejection of invalid ones
(including the cancel-then-recreate sequence Lab's review specifically flagged), via a scratch
script against a live tenant schema.

## Documentation Updates

- `Development-Standards.md`: new section documenting the catalog/requisition/report/verify
  pattern, explicitly noting the single-report-per-requisition simplification vs. Lab's
  per-component model, and the correctness fixes applied from the start.
- `pending-tasks.md`: Phase 6's Phase 2 group gets Radiology marked done under the same structure
  Lab/LIS used, with deferred pieces (image attachment, film-type billing, DICOM, report export)
  named explicitly.
