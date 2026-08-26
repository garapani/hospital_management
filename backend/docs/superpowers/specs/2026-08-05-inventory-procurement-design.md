# Inventory Module — Item A: Procurement Pipeline (Stock IN) — Design Spec

**Source:** `pending-tasks.md` Phase 6 product module backlog (PRD §5.3): Inventory, chosen after
Lab/LIS and Radiology per the user's explicit choice to skip DICOM (no PACS target in the dev
environment) and build Inventory ahead of Pharmacy, since Pharmacy dispenses from stock — the
same "build the dependency first" shape as Order-before-Lab/Radiology.

## Problem

The PRD describes Inventory as covering item master, vendor, purchase order, goods receipt, and
stock ledger concerns. No Inventory-specific code exists in `apps/api` today. Investigation of the
old system's `InventoryModels/` found a domain spanning two structurally distinct pipelines:
procurement (stock IN: `PurchaseRequest → RFQ/Quotation → PurchaseOrder → GoodsReceipt`) and
internal consumption (stock OUT: `RequisitionModel`/`DispatchModel`, the actual dependency point
Pharmacy needs). Combined, the old shape spans 11+ entities and two independent workflows — too
large for one spec/plan cycle the way Lab (5 entities) and Radiology (3 entities) were sized.

Per discussion, this is split into two items:
- **Item A (this spec):** procurement — catalog, vendor, purchase order, goods receipt, stock
  balance/ledger.
- **Item B (future, separate spec):** internal requisition/dispatch — stock OUT, the pipeline
  Pharmacy will consume from.

## Scope

**In scope (this spec):**
- Item catalog: Category → Sub-Category (carries `isConsumable`) → Item (UOM, reorder level,
  minimum stock).
- Vendor master: thin — name/contact/address only, no accounting fields.
- Purchase order: multi-line, mirrors the existing `Order`/`OrderItem` one-header-many-lines
  shape.
- Goods receipt: records delivery against a PO line, creates/matches a batch, updates stock
  balance and the PO line's received quantity in one transaction.
- Stock balance: current available quantity per item per batch, tenant-wide (no store/location
  dimension).
- Stock transaction ledger: append-only record of every balance-affecting event.

**Explicitly deferred (not in this spec, each a separate future item):**
- RFQ/Quotation — no stated need for competitive-bid tracking yet.
- Two-phase "unconfirmed" stock staging (the old system's `ConfirmStockReceived`/
  `ConfirmStockDispatched`) — rejected per the user's explicit choice; this spec updates stock
  balance immediately, in the same transaction as the goods receipt.
- Store/location concept (the old system's `StoreStockModel` per-store quantities) — rejected per
  the user's explicit choice; this spec uses a single tenant-wide stock pool.
- Vendor accounting fields (TDS, ledger, credit period) — an Accounting-domain concern, not Core
  Inventory's.
- Donations, vendor/sub-store returns, write-offs, PO drafts — no stated need.
- Multi-store, currency/fiscal-year masters — no stated need; single-currency, single-pool only.
- Internal requisition/dispatch (stock OUT) — **Item B**, a distinct future spec; this spec's
  stock balance is written-to only by goods receipt, never decremented here.
- Formal PO approval/verify workflow — RBAC-gated creation is the only control; no separate
  sign-off step (contrasted against the old system's ad-hoc verifier-list chains, which never
  cleanly finished either).

## Architecture

New domain module `apps/api/src/inventory/`, following the Lab/Radiology two-controller split:
`InventoryCatalogService`/`Controller` (category/sub-category/item/vendor CRUD — create+list only,
matching the corrected Lab/Radiology catalog scope; admin-gated) and
`InventoryProcurementService`/`Controller` (PO creation, goods receipt, stock balance query —
frequent, Inventory/Store Manager-gated). All tenant-scoped via
`TenantConnectionService.runInTenantSchema()`.

## Entities

```ts
// entities/inventory-item-category.entity.ts
@Entity('inventory_item_categories')
export class InventoryItemCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/inventory-item-sub-category.entity.ts
@Entity('inventory_item_sub_categories')
export class InventoryItemSubCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'boolean', default: false }) isConsumable!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/inventory-item.entity.ts
@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) subCategoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'varchar' }) unitOfMeasure!: string; // e.g. 'Box', 'Piece', 'Vial'
  @Column({ type: 'numeric', default: 0 }) reorderLevel!: string;
  @Column({ type: 'numeric', default: 0 }) minimumStock!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/inventory-vendor.entity.ts
@Entity('inventory_vendors')
export class InventoryVendor {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar', nullable: true }) contactPerson!: string | null;
  @Column({ type: 'varchar', nullable: true }) phone!: string | null;
  @Column({ type: 'varchar', nullable: true }) address!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/purchase-order.entity.ts
@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) vendorId!: string;
  @Column({ type: 'varchar', unique: true }) purchaseOrderNumber!: string;
  @Column({ type: 'uuid' }) orderedBy!: string;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) orderedAt!: Date;
  @Column({ type: 'varchar', default: 'Ordered' }) status!: string;
  // 'Ordered' | 'PartiallyReceived' | 'Received' | 'Cancelled'
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/purchase-order-item.entity.ts
@Entity('purchase_order_items')
export class PurchaseOrderItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) purchaseOrderId!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'numeric' }) orderedQuantity!: string;
  @Column({ type: 'numeric', default: 0 }) receivedQuantity!: string;
  @Column({ type: 'numeric' }) unitCost!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/stock-batch.entity.ts
@Entity('stock_batches')
export class StockBatch {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'varchar' }) batchNumber!: string;
  @Column({ type: 'date', nullable: true }) expiryDate!: string | null;
  @Column({ type: 'numeric' }) unitCost!: string;
  @Column({ type: 'numeric', nullable: true }) mrp!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
// Unique on (itemId, batchNumber, expiryDate) — same batch/item/expiry combination
// across multiple goods receipts resolves to the same StockBatch row.

// entities/stock-balance.entity.ts
@Entity('stock_balances')
export class StockBalance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'numeric', default: 0 }) availableQuantity!: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
// Unique on (itemId, stockBatchId) — one balance row per item/batch pair, maintained
// by incrementing UPDATE, never read-then-write from application code.

// entities/stock-transaction.entity.ts
@Entity('stock_transactions')
export class StockTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'varchar' }) transactionType!: string; // 'GoodsReceipt' (only type this spec writes)
  @Column({ type: 'uuid', nullable: true }) referenceId!: string | null; // goods-receipt-generating PurchaseOrderItem id
  @Column({ type: 'numeric' }) quantity!: string; // always positive; sign implied by transactionType
  @Column({ type: 'uuid' }) recordedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
```

`purchaseOrderNumber` is generated by `PurchaseOrderNumberGeneratorService`, copying the same
atomic-sequence pattern used by `PatientNumberGeneratorService`, `LabRequisitionNumberGeneratorService`,
and `RadiologyRequisitionNumberGeneratorService` (a `purchase_order_sequences` table, `(prefix,
year) → lastSequence`, prefix `'PO'`, zero-padded 5-digit formatting).

## Data Flow

1. Inventory/Store Manager creates a `PurchaseOrder` with one or more `PurchaseOrderItem` lines
   (`itemId`, `orderedQuantity`, `unitCost`), targeting an existing `InventoryVendor`. Mints
   `purchaseOrderNumber`, starts `status: 'Ordered'`.
2. Goods receipt: Inventory/Store Manager records a delivery against one `PurchaseOrderItem` line,
   supplying `receivedQuantity`, `batchNumber`, optional `expiryDate`, `unitCost` (may differ from
   the PO line's quoted cost), optional `mrp`. In one transaction:
   - Find-or-create the matching `StockBatch` (unique on `itemId`+`batchNumber`+`expiryDate`).
   - Insert a `StockTransaction` row (`transactionType: 'GoodsReceipt'`, `referenceId`: the PO
     item's id).
   - Upsert-increment the matching `StockBalance` row (`INSERT ... ON CONFLICT (itemId,
     stockBatchId) DO UPDATE SET "availableQuantity" = "availableQuantity" + excluded."availableQuantity"`).
   - Increment the `PurchaseOrderItem.receivedQuantity`.
   - Recompute the parent `PurchaseOrder.status`: `'Received'` once every line's
     `receivedQuantity >= orderedQuantity`, else `'PartiallyReceived'`.
   Rejected (`BadRequestException`) if `receivedQuantity <= 0`, or if the PO line's cumulative
   `receivedQuantity` would exceed its `orderedQuantity`, or if the `PurchaseOrder` is
   `'Cancelled'`.
3. Stock balance query: list current `availableQuantity` per item (optionally per batch), joined
   against `InventoryItem` for name/UOM/reorder level — supports a simple "what's in stock" view.
4. A `PurchaseOrder` is cancellable (`cancelReason` stamped) only while `status: 'Ordered'` (no
   lines yet received) — cancelling a partially-received order is out of scope; the manager
   completes or manually reconciles it instead.

## Correctness — the Lab→Radiology lesson, applied from the start

Both Lab/LIS and Radiology's final whole-branch reviews found (or, for Radiology, confirmed
avoided) the same concurrency/correctness bug classes. This spec bakes in the applicable ones from
day one:

- No nested `runInTenantSchema()` calls: `PurchaseOrderNumberGeneratorService
  .generateNextPurchaseOrderNumber()` is called *before* `createPurchaseOrder` opens its own
  `runInTenantSchema()`, never nested inside it (mirrors `PatientsService.create`).
- Goods receipt takes a `pessimistic_write` lock on its `PurchaseOrderItem` row before checking/
  incrementing `receivedQuantity` — two concurrent receipts against the same PO line must not
  double-count or overshoot `orderedQuantity`.
- `StockBalance`'s increment is a single `INSERT ... ON CONFLICT ... DO UPDATE SET
  "availableQuantity" = "availableQuantity" + excluded."availableQuantity"` — an atomic
  read-modify-write at the database level, not an application-level read-then-write (which would
  race under concurrent receipts against the same item/batch).
- `StockBatch` find-or-create uses `INSERT ... ON CONFLICT (itemId, batchNumber, expiryDate) DO
  NOTHING RETURNING *`, falling back to a `SELECT` on conflict — avoiding a duplicate-batch race
  under concurrent goods receipts for the same item/batch/expiry combination — with any `23505`
  catch scoped to the specific constraint name (`UQ_stock_batches_item_batch_expiry`), not a bare
  error-code check.
- `PurchaseOrder.status` recomputation reads all sibling `PurchaseOrderItem` rows fresh (within
  the same transaction, after the lock and increment) rather than trusting any cached line count.

## RBAC

Mirrors Lab/Radiology's shape, nouns swapped:

| Permission | Grant to | Covers |
|---|---|---|
| `inventory.catalog.manage` | Hospital Admin, Super Admin | Create/list categories/sub-categories/items/vendors (create+list only) |
| `inventory.read` | Inventory/Store Manager | View catalog, purchase orders, stock balance |
| `inventory.purchase-order.create` | Inventory/Store Manager | Create a purchase order; also gates cancel |
| `inventory.goods-receipt.enter` | Inventory/Store Manager | Record a goods receipt against a PO line |

`Inventory/Store Manager` role already exists in `seed-rbac-catalog.ts` with zero permissions —
this item is its first-ever grant, the same starting point Lab Technician and Radiology Technician
were in.

## Error Handling

Same defensive status-guard pattern as Lab/Radiology: each mutating action checks current status
and throws `ConflictException` if the transition/action isn't valid from that state;
`BadRequestException` for malformed quantities or over-receipt attempts.

## Testing

No automated tests this pass (standing project instruction) — manual verification: seed a
category/sub-category/item/vendor set, create a multi-line PO, walk goods receipts across its
lines (partial then full), confirming batch creation/matching, stock balance increments, PO status
auto-advance, and rejection of over-receipt and receipt-against-cancelled-PO, via a scratch script
against a live tenant schema.

## Documentation Updates

- `Development-Standards.md`: new section documenting the catalog/PO/goods-receipt/stock-balance
  pattern, the atomic-increment approach for `StockBalance`, and the deferred pieces.
- `pending-tasks.md`: Phase 6's Phase 2 group gets Inventory Item A marked done, with Item B
  (requisition/dispatch) named explicitly as the immediate next follow-up, and the other deferred
  pieces (RFQ/Quotation, two-phase staging, store/location, vendor accounting fields) named
  explicitly.
