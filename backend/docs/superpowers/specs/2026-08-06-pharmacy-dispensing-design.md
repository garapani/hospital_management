# Pharmacy Module — Prescription Dispensing — Design Spec

**Source:** `pending-tasks.md` Phase 6 product module backlog (PRD §5.4): Pharmacy, chosen next
after the Inventory module (Items A + B) shipped, since Pharmacy dispenses from stock and was
explicitly deferred until a working stock pipeline existed to build against.

## Problem

The PRD describes Pharmacy as: "Drug dispensing, sales, credit notes, rack/bin management,"
sourced from the old system's `ServerModel/PharmacyModels` (~55 model files) and
`Controllers/Pharmacy/*` (Sales, Credit, CreditNote, Rack, Dashboard) plus `Controllers/
Dispensary`. Investigation of that reference code found most of it is either already owned
elsewhere in this codebase or out of proportion for a first pass:

- **POS/checkout** (`PHRMInvoiceTransactionModel`, subtotal/discount/VAT/tender/change/insurance
  claim fields) essentially reimplements what `apps/api/src/billing/` (`Invoice`/`InvoiceItem`/
  `Payment`/`Deposit`) already owns — `InvoiceItem.sourceOrderItemId` already exists as the hook
  point for linking a billing line back to an `OrderItem`, the same way Lab/Radiology results
  never trigger billing automatically.
- **Rack/Bin** (`PHRMRackModel`, hierarchical shelf/bin locations within a store) is a
  location-subdivision concept finer-grained than this codebase's Inventory module supports
  today — Inventory explicitly has no Store/location dimension at all (a deliberate choice made
  when Inventory Item A was designed), so rack-within-store is out of scope by the same logic.
- **Credit billing / credit notes / supplier ledger** (`PHRMTransactionCreditBillStatus`,
  `PharmacyCreditController`, `PHRMSupplierLedgerModel`) are accounting concerns, not core
  dispensing.
- **Narcotic/controlled-substance logging**, **sales returns**, **write-offs**, and **provisional
  IPD consumption billing** are each real old-system concepts with no current consumer or stated
  need — named explicitly as deferred rather than left silently absent.

What's left, and genuinely new: **drug dispensing against a doctor's order**, decrementing the
Inventory module's stock exactly the way Inventory Item B's internal requisition/dispatch already
proved out, but order-routed like Lab/Radiology rather than department-routed like Item B.

## Scope

**In scope (this spec):**
- Dispensing: reclassifying a Pharmacy `OrderItem` against a catalog `InventoryItem`, setting a
  quantity, then dispensing — which decrements stock via the same FEFO mechanics Item B's
  fulfillment already established, and writes a `StockTransaction` ledger row.
- Cancellation, from `'Pending'` only (before any stock is touched).

**Explicitly deferred (not in this spec, each a separate future item):**
- Walk-in/OTC sales (no `OrderItem`) — this spec is prescription-driven only, matching Lab/
  Radiology's OrderItem-anchored pattern. A future item if a non-prescription retail-sale flow is
  ever needed.
- A separate verification/sign-off step after dispensing — unlike Lab/Radiology's
  create→enter-result→verify shape (where verification signs off on a *result*), dispensing has
  no separate result to check — the act of dispensing already is the terminal, stock-affecting
  action, matching Item B's request→fulfill shape (no third step) rather than Lab/Radiology's
  three-step shape.
- A pharmacy-specific drug catalog (generic name, dosage form, strength, controlled-substance
  flag) — a drug is just an `InventoryItem` whose sub-category has `isConsumable = true`. No new
  catalog, no extension to `InventoryItem`. Pharmacy-specific metadata is a future
  catalog-enrichment item if a real need arises (e.g. an actual controlled-substance compliance
  requirement).
- POS/checkout, credit billing, credit notes, supplier ledger — owned by `apps/api/src/billing/`
  already; dispensing never creates an `Invoice` automatically, matching Lab/Radiology's
  decoupling from Billing.
- Rack/bin physical location tracking — blocked on the same "no Store/location dimension"
  decision Inventory Item A already made.
- Narcotic/controlled-substance regulatory logging, sales returns, write-offs, provisional IPD
  consumption billing — each a distinct future item, no stated need yet.

## Architecture

New domain module `apps/api/src/pharmacy/`, a single service/controller pair (no catalog/workflow
split like Lab/Radiology/Inventory need, since there's no separate catalog to manage here — the
catalog is Inventory's, already built): `PharmacyDispensingService`/`PharmacyDispensingController`.
`PharmacyModule` imports `InventoryModule` (for `InventoryCatalogService.getItem`, to validate the
chosen drug exists) the same way Inventory Item B imported `MasterDataModule` for
`MasterDataService.getDepartment` — `InventoryModule` already exports `InventoryCatalogService`.
All tenant-scoped via `TenantConnectionService.runInTenantSchema()`, same as every entity in this
pipeline.

**Stock decrement is Pharmacy's own FEFO walk, not a call into `InventoryRequisitionService`.**
Pharmacy dispensing has a different actor model (`dispensedBy`, a clinical actor) and a different
ledger `referenceId` target (`PharmacyDispensing.id`, not `StockRequisitionItem.id`) than a
department stock requisition, and this codebase's established convention across every module so
far is to mirror a proven pattern as its own copy rather than extract a shared abstraction (each
of Lab/Radiology/Item A/Item B has its own near-identical number-generator service, for example —
no shared one was ever extracted). `PharmacyDispensingService` directly imports the `StockBalance`/
`StockBatch`/`StockTransaction` entity classes from `apps/api/src/inventory/entities/` (these are
plain TypeORM entity classes, not wrapped behind a service boundary — already imported this way
across module lines within `apps/api/src` today) and re-implements the same locked, ordered,
guarded FEFO walk Item B's final review already hardened. `StockTransaction.transactionType` gets
a third value, `'PharmacyDispense'`, alongside `'GoodsReceipt'`/`'Dispatch'` — using the same
polymorphic-`referenceId`-by-`transactionType` convention Item B's final review documented in
`Development-Standards.md` §17 (no DB-level FK or discriminator column other than
`transactionType` itself).

## Entities

```ts
// entities/pharmacy-dispensing.entity.ts
@Entity('pharmacy_dispensings')
export class PharmacyDispensing {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) orderItemId!: string;
  @Column({ type: 'uuid' }) inventoryItemId!: string;
  @Column({ type: 'varchar', unique: true }) dispensingNumber!: string;
  @Column({ type: 'numeric' }) quantity!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'Dispensed' | 'Cancelled'
  @Column({ type: 'uuid', nullable: true }) dispensedBy!: string | null;
  @Column({ type: 'timestamptz', nullable: true }) dispensedAt!: Date | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`dispensingNumber` is generated by `PharmacyDispensingNumberGeneratorService`, copying the same
atomic-sequence pattern used five times already in this codebase (`PatientNumberGeneratorService`,
`LabRequisitionNumberGeneratorService`, `RadiologyRequisitionNumberGeneratorService`,
`PurchaseOrderNumberGeneratorService`, `StockRequisitionNumberGeneratorService`) — a
`pharmacy_dispensing_sequences` table, `(prefix, year) → lastSequence`, prefix `'RX'`, zero-padded
5-digit formatting.

## Data Flow

1. Doctor places a Pharmacy order exactly as today — `OrderItem` with `itemType='Pharmacy'`,
   free-text `itemDescription`. **No change to `Order`/`OrderItem` or the Orders module.**
2. A Pharmacist creates a `PharmacyDispensing` record, supplying `orderItemId` and the catalog
   `inventoryItemId` they've matched it to (the reclassification step — same shape as Lab/
   Radiology's requisition creation), plus `quantity`. Mints `dispensingNumber`, starts
   `status: 'Pending'`. Rejected (`BadRequestException`) if the `OrderItem` isn't
   `itemType='Pharmacy'` or is already `'Cancelled'`; rejected (`ConflictException`) if a
   non-cancelled dispensing already exists for that `orderItemId` — the duplicate-race prevention
   baked in from day one (`Not('Cancelled')` filter plus a partial unique index in the initial
   migration, not a follow-up fix), same as Radiology's and every module since.
3. The Pharmacist dispenses: an FEFO walk against `StockBalance`/`StockBatch` for
   `inventoryItemId`, structurally identical to Item B's `fulfillRequisitionItem` — locked via a
   query builder scoped to `FOR UPDATE OF balance` only (not the joined `stock_batches` table),
   ordered `expiryDate ASC NULLS LAST` tie-broken by `createdAt`/`id`, insufficient-stock rejected
   before any write, each per-batch decrement a guarded `UPDATE ... WHERE availableQuantity >= $1
   RETURNING id` read as the `[rows, rowCount]` tuple this codebase's TypeORM version returns for
   `UPDATE ... RETURNING` (checking `result[1] === 0`, never `result.length`), a post-loop
   `remaining > 0` invariant. Writes one `StockTransaction` row per batch consumed
   (`transactionType: 'PharmacyDispense'`, `referenceId`: the `PharmacyDispensing` id). Moves
   straight to `status: 'Dispensed'`, stamping `dispensedBy`/`dispensedAt` — no separate verify
   step.
4. Cancellable (`cancelReason` stamped) only from `'Pending'` — before any stock is touched,
   matching Item A's PO and Item B's requisition cancel rules exactly.

## Correctness — every lesson from this pipeline's four prior modules, applied from day one

- The existing-dispensing check in `createDispensing` filters `status != 'Cancelled'` (TypeORM
  `Not('Cancelled')`), and the initial migration includes the matching partial unique index from
  day one — the mistake Lab/LIS made (adding this in a follow-up migration) is not repeated a
  third time.
- `PharmacyDispensingNumberGeneratorService.generateNextDispensingNumber()` and
  `InventoryCatalogService.getItem()` are both called *before* `createDispensing` opens its own
  `runInTenantSchema()` — never nested inside it.
- `dispenseDrug` takes a `pessimistic_write` lock on the `PharmacyDispensing` row before checking
  status.
- The FEFO query builder's lock is scoped to `.setLock('pessimistic_write', undefined,
  ['balance'])` — Item B's own final-review fix, applied here from the start rather than
  discovered again.
- Every client-supplied numeric field (`quantity`) is validated with `typeof x !== 'number' ||
  !Number.isFinite(x) || x <= 0` before any arithmetic or storage — not just `Number.isFinite`.
- Every client-supplied actor field (`dispensedBy`) is guarded with `!x?.trim()` →
  `BadRequestException`, before any database write.
- `createDispensing` rejects a cancelled `OrderItem` immediately (`BadRequestException`).

## RBAC

| Permission | Grant to | Covers |
|---|---|---|
| `pharmacy.read` | Pharmacist, Doctor | View dispensing records |
| `pharmacy.dispensing.create` | Pharmacist | Create a dispensing record from an OrderItem; also gates cancel |
| `pharmacy.dispensing.dispense` | Pharmacist | Dispense (decrement stock) against a dispensing record |

Doctor gets `pharmacy.read` per the PRD's stated cross-role visibility ("Doctor: ... Pharmacy
(results/status)"). `Pharmacist` role already exists in `seed-rbac-catalog.ts` with zero
permissions — this item is its first-ever grant, the same starting point every operational role in
this pipeline has been in.

## Error Handling

Same defensive status-guard pattern as every workflow action in this codebase: each mutating
action checks current status and throws `ConflictException` if the transition isn't valid;
`BadRequestException` for malformed/invalid quantities, insufficient available stock, and
cancelled/wrong-type `OrderItem` references; `NotFoundException` for missing dispensing/item
references.

## Testing

No automated tests this pass (standing project instruction) — manual verification: seed an
inventory item with stock (via Inventory's goods receipt), place an Order with a Pharmacy
`OrderItem`, walk it through dispensing creation → dispense, confirming FEFO batch selection,
stock decrement, ledger write, and rejection of insufficient stock, duplicate dispensing, and
cancel-after-dispense — via a scratch script against a live tenant schema.

## Documentation Updates

- `Development-Standards.md`: new section documenting the dispensing pattern, explicitly noting
  it reuses Item B's FEFO mechanics as its own copy (not a shared call) and adds
  `'PharmacyDispense'` as a third `stock_transactions.transactionType` value.
- `pending-tasks.md`: Phase 6's Pharmacy entry marked done, with deferred pieces (walk-in/OTC
  sales, verification step, pharmacy-specific drug catalog, POS/checkout, rack/bin, credit
  billing, narcotic logging, returns, write-offs, provisional IPD billing) named explicitly.
