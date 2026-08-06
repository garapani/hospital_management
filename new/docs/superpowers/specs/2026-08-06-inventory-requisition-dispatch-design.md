# Inventory Module — Item B: Requisition/Dispatch Pipeline (Stock OUT) — Design Spec

**Source:** `pending-tasks.md` Phase 6 product module backlog. Second and final half of the Inventory
module — Item A (procurement, stock IN: catalog, vendor, PO, goods receipt, stock balance/ledger)
shipped first (`new/docs/superpowers/specs/2026-08-05-inventory-procurement-design.md`); this spec
covers the agreed-upon Item B split from that same brainstorming session: internal
requisition/dispatch, the stock-OUT pipeline Pharmacy depends on.

## Problem

The old system's internal-consumption domain (`old/hospital-management-emr/.../InventoryModels/
RequisitionModel.cs`, `RequisitionItemsModel.cs`, `DispatchModel.cs`, `DispatchItemsModel.cs`)
carries substantial scope this project has already deliberately rejected for the new Inventory
module: Store-to-store routing (`RequestFromStoreId`/`RequestToStoreId`/`SourceStoreId`/
`TargetStoreId` — no Store/location concept exists here, per Item A's design), multi-level
verification chains (`VerificationId`, `CurrentVerificationLevel`, `VerifierIds`), fiscal-year
tracking, a "direct dispatch" bypass path, and a fixed-asset dispatch sub-type
(`MAP_DispatchItems_FixedAssetStock`). Stripped to what actually fits this project's established
choices (single tenant-wide stock pool, no formal approval workflow, immediate updates, no
two-phase staging), the core loop is much simpler than the old system's: someone requests items,
someone fulfills the request by decrementing stock.

## Scope

**In scope (this spec):**
- Requisition: a department's request for a quantity of one or more catalog items.
- Fulfillment: decrementing `StockBalance` against a requisition line, auto-selecting batches
  oldest-expiry-first (FEFO), writing `StockTransaction` ledger rows.
- Partial fulfillment across multiple fulfillment calls as stock becomes available.
- Cancellation, from `Pending` only (mirrors Item A's PO cancel rule).

**Explicitly deferred (not in this spec, each a separate future item):**
- Store-to-store / sub-store routing — no Store/location concept in this module at all, per Item
  A's already-established choice.
- Multi-level verification/approval chains — same reasoning as every other module in this
  pipeline (Lab, Radiology, Item A): no stated need for configurable multi-level sign-off.
- Fixed-asset dispatch tracking — a distinct old-system concern (`FixedAssetStockModel`) with no
  current consumer.
- "Direct dispatch" (bypassing the requisition step entirely) — the two-step
  request-then-fulfill flow was the explicit design choice for this spec; a bypass path
  contradicts the reason a requisition exists at all.
- Manual batch selection by the fulfiller — FEFO auto-selection was the explicit design choice;
  no UI layer exists in this codebase to make manual per-batch picking ergonomic anyway.
- A dedicated requester role distinct from `Inventory/Store Manager` — no ward/nursing role exists
  yet in this codebase (Nursing is still an unstarted Phase 6 backlog item) to split
  requester-vs-fulfiller permissions across; both actions stay within `Inventory/Store Manager`'s
  existing permission set, same single-role scope Item A used.

## Architecture

Extends the existing `apps/api/src/inventory/` module (not a new module) — this is the second half
of the same Inventory domain, sharing its entities, RBAC role, and `InventoryModule` registration.
Follows the established two-controller split: a new `InventoryRequisitionController` (create,
list, get, cancel — `inventory.requisition.create`/`inventory.read`-gated) and a new
`InventoryDispatchController` (fulfill — `inventory.dispatch.fulfill`-gated), backed by a new
`InventoryRequisitionService`. All tenant-scoped via `TenantConnectionService.runInTenantSchema()`,
same as every entity in this module.

**No separate "Dispatch" header entity** — mirroring Item A's own goods-receipt shape, which has
no separate report/receipt entity either. A fulfillment call directly increments
`StockRequisitionItem.fulfilledQuantity`, decrements one or more `StockBalance` rows, and writes
one `StockTransaction` row per batch consumed (a new `transactionType: 'Dispatch'` value on the
existing `stock_transactions` table — no schema change needed there, `transactionType` is already
a plain `varchar`).

## Entities

```ts
// entities/stock-requisition.entity.ts
@Entity('stock_requisitions')
export class StockRequisition {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) departmentId!: string;
  @Column({ type: 'uuid' }) requestedBy!: string;
  @Column({ type: 'varchar', unique: true }) requisitionNumber!: string;
  @Column({ type: 'varchar', default: 'Pending' }) status!: string;
  // 'Pending' | 'PartiallyFulfilled' | 'Fulfilled' | 'Cancelled'
  @Column({ type: 'text', nullable: true }) notes!: string | null;
  @Column({ type: 'text', nullable: true }) cancelReason!: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}

// entities/stock-requisition-item.entity.ts
@Entity('stock_requisition_items')
export class StockRequisitionItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) requisitionId!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'numeric' }) requestedQuantity!: string;
  @Column({ type: 'numeric', default: 0 }) fulfilledQuantity!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`requisitionNumber` is generated by `StockRequisitionNumberGeneratorService`, copying the same
atomic-sequence pattern used four times already in this codebase (`PatientNumberGeneratorService`,
`LabRequisitionNumberGeneratorService`, `RadiologyRequisitionNumberGeneratorService`,
`PurchaseOrderNumberGeneratorService`) — a `stock_requisition_sequences` table, `(prefix, year) →
lastSequence`, prefix `'REQ'`, zero-padded 5-digit formatting.

`departmentId` references the existing `Department` entity (`apps/api/src/master-data/entities/
department.entity.ts`) — no new master-data concept, reusing what Admissions/Wards already use.

## Data Flow

1. **Create requisition.** Caller supplies `departmentId`, `requestedBy`, and one or more lines
   (`itemId`, `requestedQuantity`). Validates: non-empty items array; every `requestedQuantity` is
   a `typeof === 'number'`, finite, positive value (the numeric-coercion pattern Item A's final
   review established — applied from the start here, not retrofitted); `requestedBy` is a
   non-empty trimmed string (the actor-field guard pattern from the same review); `departmentId`
   exists (a direct existence check against `Department`, no new service needed for a single
   lookup); every `itemId` exists (via `InventoryCatalogService.getItemsByIds` — the batched
   lookup Item A's final review introduced, reused here rather than a per-line loop). Mints
   `requisitionNumber`, starts `status: 'Pending'`.
2. **Fulfill a line.** Caller supplies `purchaseOrderItemId`-equivalent (`stockRequisitionItemId`),
   a `quantity` to dispatch this round, and `fulfilledBy`. Guards: `quantity` is a
   `typeof === 'number'`, finite, positive value; `fulfilledBy` is non-empty. Takes
   `pessimistic_write` locks on the `StockRequisitionItem` row and its parent `StockRequisition`
   row (same double-lock shape as Item A's `recordGoodsReceipt`). Rejects (`ConflictException`) if
   the parent requisition isn't in `'Pending'` or `'PartiallyFulfilled'`. Computes
   `newFulfilledQuantity = existing + quantity`; rejects (`BadRequestException`) if it would
   exceed `requestedQuantity` (the over-fulfillment guard, same shape as Item A's over-receipt
   guard).

   **FEFO batch walk:** queries `StockBalance` rows for the item (joined to `StockBatch` for
   `expiryDate`) where `availableQuantity > 0`, ordered by `expiryDate ASC NULLS LAST` (batches
   with a nearer expiry are consumed first; batches with no recorded expiry are consumed last,
   since they don't expire), taking a `pessimistic_write` lock across all matched rows in one
   query (TypeORM's `find()` with `lock: { mode: 'pessimistic_write' }` locks every row the query
   matches, not just a single row — a new-but-analogous usage of a pattern this module already
   relies on). Walks the locked rows in order, taking `min(remaining needed, row.availableQuantity)`
   from each until the requested `quantity` is fully covered. **If the total available quantity
   across all batches is less than the requested `quantity`, the entire call is rejected**
   (`BadRequestException` naming the shortfall: available vs. requested) **before any write
   happens** — no silent partial application within one call. The caller can retry with a smaller
   quantity, or simply call again later as more stock arrives via Item A's goods receipt; the
   requisition line just stays at whatever `fulfilledQuantity` it already reached.

   For each batch portion consumed: an `UPDATE stock_balances SET "availableQuantity" =
   "availableQuantity" - $1 WHERE id = $2 AND "availableQuantity" >= $1` (the trailing
   `>= $1` is a defense-in-depth guard against ever writing a negative balance, even though the
   preceding lock should already make this impossible — if it somehow affects zero rows, treat
   that as an internal error, not a silent no-op) decrements the balance, and a `StockTransaction`
   row is inserted (`transactionType: 'Dispatch'`, `referenceId`: the `StockRequisitionItem` id,
   `quantity`: the portion taken from that batch, `recordedBy`: `fulfilledBy`).

   `StockRequisitionItem.fulfilledQuantity` is incremented by the full requested `quantity`
   (not per-batch-portion — the line tracks total fulfilled, the ledger tracks per-batch detail).
   `StockRequisition.status` is recomputed fresh from all sibling `StockRequisitionItem` rows
   (never trusted from a cached value) to `'Fulfilled'` if every line's `fulfilledQuantity >=
   requestedQuantity`, else `'PartiallyFulfilled'`.
3. **Cancel.** Takes a `pessimistic_write` lock on the `StockRequisition` row; only valid from
   `'Pending'` (mirrors Item A's PO cancel rule — no lines fulfilled yet). `cancelReason` stamped.

## Correctness — applied from the start, per the pattern this module's own Item A had to learn

Item A's final whole-branch review found real defects in exactly this shape of code (numeric
coercion, actor-field guards, batched existence lookups, nested-transaction avoidance). This spec
bakes all of them in from day one rather than retrofitting them after a review:

- Every client-supplied numeric field (`requestedQuantity`, fulfillment `quantity`) is validated
  with `typeof x !== 'number' || !Number.isFinite(x) || x <= 0` before any arithmetic or storage —
  not just `Number.isFinite`, since a bare `Number()` coercion would silently accept `true`
  (→ `1`), `[]` (→ `0`), and stringified numbers without rejecting them.
- Every client-supplied actor field (`requestedBy`, `fulfilledBy`) is guarded with
  `!x?.trim()` → `BadRequestException`, before any database write.
- Item existence is checked via `InventoryCatalogService.getItemsByIds` (one batched query),
  called *before* `createRequisition` opens its own `runInTenantSchema()` — never a per-line loop,
  never nested inside the transaction.
- `StockRequisitionNumberGeneratorService.generateNextRequisitionNumber()` is called before the
  transaction opens, same hoisting rule as every other number generator in this codebase.
- The FEFO batch walk takes locks up front (via the locked `find()` query) before any decrement,
  and every decrement is a direct arithmetic `UPDATE` (not an `ON CONFLICT` upsert — the row is
  guaranteed to already exist, since the FEFO query only selects rows with `availableQuantity > 0`)
  guarded by a `WHERE availableQuantity >= $1` clause as a defense-in-depth backstop.
- `StockRequisition.status` recomputation reads all sibling `StockRequisitionItem` rows fresh,
  within the same transaction, after the lock and increment — never trusts a cached count.

## RBAC

| Permission | Grant to | Covers |
|---|---|---|
| `inventory.requisition.create` | Inventory/Store Manager | Create a requisition; also gates cancel |
| `inventory.dispatch.fulfill` | Inventory/Store Manager | Fulfill a requisition line |

Reuses the existing `inventory.read` permission (already granted to Inventory/Store Manager) for
all read/list/get endpoints on requisitions — no new read permission needed. Both new permissions
grant to `Super Admin` as well, matching every other permission in this module.

## Error Handling

Same defensive status-guard pattern as every workflow action in this codebase: each mutating
action checks current status and throws `ConflictException` if the transition isn't valid;
`BadRequestException` for malformed/invalid quantities, insufficient available stock, and
over-fulfillment attempts; `NotFoundException` for missing requisition/item/department references.

## Testing

No automated tests this pass (standing project instruction) — manual verification: seed a
department reference and inventory items/stock (via Item A's goods receipt), create a requisition
with multiple lines, fulfill partially (confirm `PartiallyFulfilled`), fulfill the remainder
(confirm `Fulfilled`), confirm FEFO ordering picks the nearer-expiry batch first when multiple
batches exist for the same item, confirm insufficient-stock rejection leaves no partial state
behind, and confirm cancel is rejected once any fulfillment has happened — via a scratch script
against a live tenant schema.

## Documentation Updates

- `Development-Standards.md`: new section documenting the requisition/fulfillment pattern, the
  FEFO batch-walk mechanics, and the locked-`find()` usage as a new-but-analogous pattern.
- `pending-tasks.md`: Phase 6's Inventory sub-item extended to note Item B (requisition/dispatch)
  done, with deferred pieces (store-to-store routing, multi-level verification, fixed-asset
  dispatch, direct-dispatch bypass, manual batch selection) named explicitly. With both Item A and
  Item B complete, Inventory as a whole is now positioned to unblock Pharmacy.
