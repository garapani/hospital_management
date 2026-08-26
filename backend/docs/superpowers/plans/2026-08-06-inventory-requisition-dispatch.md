# Inventory Module — Item B: Requisition/Dispatch Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inventory module's requisition/dispatch pipeline (stock OUT): a
department-based requisition, FEFO-driven fulfillment against `StockBalance`, and the
`stock_transactions` ledger entries that pair with Item A's `GoodsReceipt` entries — following
`new/docs/superpowers/specs/2026-08-06-inventory-requisition-dispatch-design.md`.

**Architecture:** Extends the existing `apps/api/src/inventory/` module (not a new module) with a
new `InventoryRequisitionService` (create/read/cancel requisitions, plus FEFO fulfillment), a new
`InventoryRequisitionController` (requisition CRUD) and `InventoryDispatchController` (fulfill),
two new entities, and one new migration. All tenant-scoped via
`TenantConnectionService.runInTenantSchema()`, matching every other entity in this module.

**Tech Stack:** NestJS, TypeORM 1.1.0 + Postgres 16 (schema-per-tenant), pnpm workspace
`apps/api`. No new dependencies.

## Global Constraints

- Table names (snake_case): `stock_requisitions`, `stock_requisition_items`,
  `stock_requisition_sequences`.
- Migration file: `0023-create-inventory-requisition-tables.ts`, class
  `CreateInventoryRequisitionTables0023`, `name =
  'CreateInventoryRequisitionTables00232000000000020'` (continuing the `<ClassName>
  <4-digit-file-number>2000000000<order-suffix>` convention — order suffix `020` follows
  `0022`'s `019`).
- Requisition number: prefix `'REQ'`, atomic `(prefix, year) → lastSequence` sequence table
  (`stock_requisition_sequences`), zero-padded 5-digit sequence, format `REQ-<year>-<00001>` —
  copies `PurchaseOrderNumberGeneratorService`'s pattern exactly.
- `departmentId` references the existing `Department` entity
  (`apps/api/src/master-data/entities/department.entity.ts`); existence is validated via
  `MasterDataService.getDepartment(id)` (already exists, returns `Department | null` — this plan
  does not modify `MasterDataService`), which requires `InventoryModule` to add `MasterDataModule`
  to its own `imports` array (it currently has none — `MasterDataModule` is not `@Global()`,
  unlike `DatabaseModule`, so this import is required for injection to work).
- Permissions (nested-dot convention): `inventory.requisition.create`,
  `inventory.dispatch.fulfill`. Both grant to `Super Admin` and `Inventory/Store Manager`
  (mirroring every other Inventory permission's grant pattern). Reuses the existing
  `inventory.read` permission for all read endpoints — no new read permission.
- Every client-supplied numeric field is validated with `typeof x !== 'number' ||
  !Number.isFinite(x) || <range check>` before any arithmetic or storage — copied verbatim from
  `InventoryProcurementService`'s established pattern (`inventory-procurement.service.ts:65-76`).
- Every client-supplied actor field is guarded with `!x?.trim()` →
  `BadRequestException`, before any database write — same pattern as `orderedBy`/`recordedBy` in
  `InventoryProcurementService`.
- Item existence is checked via the existing `InventoryCatalogService.getItemsByIds(ids)` (one
  batched query, already built — `inventory-catalog.service.ts:145-155`), called *before*
  `createRequisition` opens its own `runInTenantSchema()` — never a per-line loop, never nested
  inside a transaction.
- `StockRequisitionNumberGeneratorService.generateNextRequisitionNumber()` is called before the
  transaction opens, same hoisting rule as every other number generator in this codebase.
- FEFO batch walk: `StockBalance` rows for the item, `availableQuantity > 0`, locked via
  `.setLock('pessimistic_write')` on a query builder joined to `StockBatch`, ordered by
  `batch.expiryDate ASC NULLS LAST` (nearer-expiry batches consumed first; no-expiry batches
  consumed last). If total available quantity across all matched batches is less than the
  requested fulfillment quantity, the whole call is rejected (`BadRequestException`, no partial
  write) before any decrement happens.
- Each per-batch decrement is `UPDATE stock_balances SET "availableQuantity" =
  "availableQuantity" - $1 WHERE id = $2 AND "availableQuantity" >= $1 RETURNING id` — the
  trailing `>= $1` is a defense-in-depth guard; if it returns zero rows (should be impossible
  given the preceding lock), throw a plain `Error` (not a client-facing exception — this signals
  an internal invariant violation, not a client mistake).
- `StockRequisition.status` recomputation reads all sibling `StockRequisitionItem` rows fresh,
  within the same transaction, after the lock and increment — never trusts a cached count.
- Cancel is valid only from `'Pending'` — mirrors `PurchaseOrder`'s cancel rule (no lines
  fulfilled/received yet).
- New `stock_transactions.transactionType` value: `'Dispatch'` (no schema change — the column is
  already a plain `varchar`).

---

### Task 1: Entities and migration

**Files:**
- Create: `apps/api/src/inventory/entities/stock-requisition.entity.ts`
- Create: `apps/api/src/inventory/entities/stock-requisition-item.entity.ts`
- Create: `apps/api/src/database/migrations/0023-create-inventory-requisition-tables.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: `StockRequisition` and `StockRequisitionItem` entity classes, exact field
  names/types below — every later task imports these verbatim.

- [ ] **Step 1: Write the entity files**

`apps/api/src/inventory/entities/stock-requisition.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
```

`apps/api/src/inventory/entities/stock-requisition-item.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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

- [ ] **Step 2: Write the migration**

`apps/api/src/database/migrations/0023-create-inventory-requisition-tables.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryRequisitionTables0023 implements MigrationInterface {
  name = 'CreateInventoryRequisitionTables00232000000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE stock_requisitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentId" uuid NOT NULL,
        "requestedBy" uuid NOT NULL,
        "requisitionNumber" varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        notes text NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_stock_requisitions_requisition_number" UNIQUE ("requisitionNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_requisitions_department_id" ON stock_requisitions ("departmentId")`,
    );
    await queryRunner.query(`
      CREATE TABLE stock_requisition_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "requisitionId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "requestedQuantity" numeric NOT NULL,
        "fulfilledQuantity" numeric NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_requisition_items_requisition_id" ON stock_requisition_items ("requisitionId")`,
    );
    await queryRunner.query(`
      CREATE TABLE stock_requisition_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE stock_requisition_sequences`);
    await queryRunner.query(`DROP TABLE stock_requisition_items`);
    await queryRunner.query(`DROP TABLE stock_requisitions`);
  }
}
```

- [ ] **Step 3: Register the migration**

Modify `apps/api/src/database/migrations/index.ts`: add
`import { CreateInventoryRequisitionTables0023 } from
'./0023-create-inventory-requisition-tables.js';` after the `CreateInventoryTables0022` import,
and append `CreateInventoryRequisitionTables0023` as the last entry in the `TENANT_MIGRATIONS`
array.

- [ ] **Step 4: Register the entities**

Modify `apps/api/src/database/data-source.ts`: add imports for `StockRequisition` and
`StockRequisitionItem` (mirroring the existing `../inventory/entities/*.entity.js` import block)
and append `StockRequisition, StockRequisitionItem` to the `entities` array.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inventory/entities/stock-requisition.entity.ts apps/api/src/inventory/entities/stock-requisition-item.entity.ts apps/api/src/database/migrations/0023-create-inventory-requisition-tables.ts apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts
git commit -m "feat(inventory): add requisition/dispatch core tables and entities"
```

---

### Task 2: RBAC permissions and role grants

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Consumes: role `'Inventory/Store Manager'` (already exists, already holds `inventory.read`,
  `inventory.purchase-order.create`, `inventory.goods-receipt.enter` from Item A).
- Produces: permission names `inventory.requisition.create`, `inventory.dispatch.fulfill`, used
  verbatim by `@RequirePermission()` in Task 6's controllers.

- [ ] **Step 1: Add the two permissions**

In the permissions array, immediately after the existing `inventory.goods-receipt.enter` entry,
add:
```ts
  {
    name: 'inventory.requisition.create',
    description: 'Create a stock requisition; also gates cancellation',
  },
  {
    name: 'inventory.dispatch.fulfill',
    description: 'Fulfill a stock requisition line, decrementing stock balance',
  },
```

- [ ] **Step 2: Add the role-permission mappings**

In the role-permission mapping array, immediately after the existing
`{ roleName: 'Inventory/Store Manager', permissionName: 'inventory.goods-receipt.enter' }` line,
add:
```ts
  { roleName: 'Super Admin', permissionName: 'inventory.requisition.create' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'inventory.dispatch.fulfill' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.dispatch.fulfill' },
```

- [ ] **Step 3: Typecheck and run the RBAC seed test suite**

Run: `pnpm exec nx run api:typecheck`
Run: `pnpm exec nx test api --testPathPattern=rbac`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add requisition/dispatch permissions to Inventory/Store Manager"
```

---

### Task 3: Requisition number generator

**Files:**
- Create: `apps/api/src/inventory/stock-requisition-number-generator.service.ts`

**Interfaces:**
- Produces: `StockRequisitionNumberGeneratorService.generateNextRequisitionNumber(prefix =
  'REQ'): Promise<string>` — called by Task 4's `InventoryRequisitionService.createRequisition`
  *before* it opens its own `runInTenantSchema()`.

- [ ] **Step 1: Write the generator service**

`apps/api/src/inventory/stock-requisition-number-generator.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class StockRequisitionNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextRequisitionNumber(prefix = 'REQ'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO stock_requisition_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = stock_requisition_sequences."lastSequence" + 1
        RETURNING "lastSequence"
        `,
        [prefix, currentYear],
      );

      const nextSeq = result[0].lastSequence as number;
      const paddedSeq = String(nextSeq).padStart(5, '0');
      return `${prefix}-${currentYear}-${paddedSeq}`;
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/inventory/stock-requisition-number-generator.service.ts
git commit -m "feat(inventory): add atomic requisition-number generator"
```

---

### Task 4: Requisition creation, read, and cancel

**Files:**
- Create: `apps/api/src/inventory/inventory-requisition.service.ts`

**Interfaces:**
- Consumes: `StockRequisitionNumberGeneratorService.generateNextRequisitionNumber()` (Task 3),
  `InventoryCatalogService.getItemsByIds(ids)` (already exists —
  `inventory-catalog.service.ts:145-155`), `MasterDataService.getDepartment(id)` (already exists
  — `master-data/master-data.service.ts:61-65`, returns `Department | null`), `StockRequisition`
  / `StockRequisitionItem` entities (Task 1).
- Produces: `InventoryRequisitionService.createRequisition(input:
  CreateRequisitionInput): Promise<StockRequisition & { items: StockRequisitionItem[] }>`,
  `.findOne(id: string): Promise<...>`, `.listByDepartment(departmentId: string):
  Promise<StockRequisition[]>`, `.cancel(id: string, cancelReason?: string):
  Promise<StockRequisition>` — all consumed by Task 6's controller. Task 5 adds
  `fulfillRequisitionItem` to this same service/file.

- [ ] **Step 1: Write the service (creation, read, cancel)**

`apps/api/src/inventory/inventory-requisition.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { StockRequisition } from './entities/stock-requisition.entity.js';
import { StockRequisitionItem } from './entities/stock-requisition-item.entity.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';

export interface CreateRequisitionItemInput {
  itemId: string;
  requestedQuantity: number;
}

export interface CreateRequisitionInput {
  departmentId: string;
  requestedBy: string;
  notes?: string;
  items: CreateRequisitionItemInput[];
}

const NON_TERMINAL_REQUISITION_STATUSES = ['Pending', 'PartiallyFulfilled'];

@Injectable()
export class InventoryRequisitionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly requisitionNumberGenerator: StockRequisitionNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
    private readonly masterDataService: MasterDataService,
  ) {}

  async createRequisition(
    input: CreateRequisitionInput,
  ): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    if (!input.requestedBy?.trim()) {
      throw new BadRequestException('requestedBy is required');
    }
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A requisition must include at least one item');
    }

    const validatedItems: Array<{ itemId: string; requestedQuantity: number }> = [];
    for (const line of input.items) {
      const requestedQuantity = Number(line.requestedQuantity);
      if (
        typeof line.requestedQuantity !== 'number' ||
        !Number.isFinite(requestedQuantity) ||
        requestedQuantity <= 0
      ) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive requestedQuantity`);
      }
      validatedItems.push({ itemId: line.itemId, requestedQuantity });
    }

    const department = await this.masterDataService.getDepartment(input.departmentId);
    if (!department) {
      throw new NotFoundException(`Department ${input.departmentId} not found`);
    }
    // Single batched existence check instead of one getItem call (and transaction) per line.
    await this.inventoryCatalogService.getItemsByIds(validatedItems.map((line) => line.itemId));

    const requisitionNumber = await this.requisitionNumberGenerator.generateNextRequisitionNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.save(
        requisitionRepository.create({
          departmentId: input.departmentId,
          requestedBy: input.requestedBy,
          requisitionNumber,
          notes: input.notes ?? null,
          status: 'Pending',
        }),
      );

      const itemRepository = manager.getRepository(StockRequisitionItem);
      const items = await itemRepository.save(
        validatedItems.map((line) => {
          const itemData: Partial<StockRequisitionItem> = {
            requisitionId: requisition.id,
            itemId: line.itemId,
            requestedQuantity: String(line.requestedQuantity),
          };
          return itemRepository.create(itemData);
        }),
      );

      return { ...requisition, items };
    });
  }

  async findOne(id: string): Promise<StockRequisition & { items: StockRequisitionItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const requisition = await manager.getRepository(StockRequisition).findOne({ where: { id } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      const items = await manager
        .getRepository(StockRequisitionItem)
        .find({ where: { requisitionId: id }, order: { createdAt: 'ASC' } });
      return { ...requisition, items };
    });
  }

  async listByDepartment(departmentId: string): Promise<StockRequisition[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(StockRequisition).find({ where: { departmentId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<StockRequisition> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(StockRequisition);
      const requisition = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${id} not found`);
      }
      if (requisition.status !== 'Pending') {
        throw new ConflictException(
          `Requisition ${id} can only be cancelled while status is Pending (current: ${requisition.status})`,
        );
      }

      requisition.status = 'Cancelled';
      requisition.cancelReason = cancelReason ?? null;
      return repository.save(requisition);
    });
  }
}
```

Note: `NON_TERMINAL_REQUISITION_STATUSES` is declared here but not yet used by any method in this
task — Task 5's `fulfillRequisitionItem` is what consumes it (checking the parent requisition's
status before fulfilling a line). This mirrors the exact situation Item A's Task 5 hit: an unused
module-level `const` causes a genuine `TS6133` typecheck failure in this repo's tsconfig, not just
a lint warning. **Do not declare it in this task.** It is listed in the Global Constraints and in
Task 5's own code block below — Task 5 is where it must first appear in the diff.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS. If you see `TS6133: 'NON_TERMINAL_REQUISITION_STATUSES' is declared but its value
is never read`, you have included the constant declaration in this task's file by mistake — remove
it from this task's version of the file entirely (it belongs in Task 5's diff, not this one).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/inventory/inventory-requisition.service.ts
git commit -m "feat(inventory): add requisition creation, read, and cancel"
```

---

### Task 5: FEFO fulfillment

**Files:**
- Modify: `apps/api/src/inventory/inventory-requisition.service.ts`

**Interfaces:**
- Consumes: `StockBatch`, `StockBalance`, `StockTransaction` entities (already exist, from Item
  A — `apps/api/src/inventory/entities/`).
- Produces: `InventoryRequisitionService.fulfillRequisitionItem(stockRequisitionItemId: string,
  input: FulfillRequisitionItemInput): Promise<StockRequisitionItem>` — consumed by Task 6's
  controller.

- [ ] **Step 1: Add the `NON_TERMINAL_REQUISITION_STATUSES` constant and the fulfillment method**

Add this constant near the top of `apps/api/src/inventory/inventory-requisition.service.ts`,
immediately after the `CreateRequisitionInput` interface (this is the first task where it's
actually consumed, per Task 4's note):
```ts
const NON_TERMINAL_REQUISITION_STATUSES = ['Pending', 'PartiallyFulfilled'];
```

Add these imports to the top of the file (alongside the existing ones from Task 4):
```ts
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
```

Add this interface near the top of the file, alongside `CreateRequisitionInput`:
```ts
export interface FulfillRequisitionItemInput {
  quantity: number;
  fulfilledBy: string;
}
```

Add this method to the `InventoryRequisitionService` class, after `cancel`:
```ts
  async fulfillRequisitionItem(
    stockRequisitionItemId: string,
    input: FulfillRequisitionItemInput,
  ): Promise<StockRequisitionItem> {
    if (!input.fulfilledBy?.trim()) {
      throw new BadRequestException('fulfilledBy is required');
    }
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const reqItemRepository = manager.getRepository(StockRequisitionItem);
      const reqItem = await reqItemRepository.findOne({
        where: { id: stockRequisitionItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reqItem) {
        throw new NotFoundException(`Stock requisition item ${stockRequisitionItemId} not found`);
      }

      const requisitionRepository = manager.getRepository(StockRequisition);
      const requisition = await requisitionRepository.findOne({
        where: { id: reqItem.requisitionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!requisition) {
        throw new NotFoundException(`Stock requisition ${reqItem.requisitionId} not found`);
      }
      if (!NON_TERMINAL_REQUISITION_STATUSES.includes(requisition.status)) {
        throw new ConflictException(
          `Requisition ${requisition.id} cannot be fulfilled from status ${requisition.status}`,
        );
      }

      const newFulfilledQuantity = Number(reqItem.fulfilledQuantity) + quantity;
      if (newFulfilledQuantity > Number(reqItem.requestedQuantity)) {
        throw new BadRequestException(
          `Fulfilling ${quantity} would exceed the requested quantity for line ${stockRequisitionItemId} ` +
            `(requested: ${reqItem.requestedQuantity}, already fulfilled: ${reqItem.fulfilledQuantity})`,
        );
      }

      // FEFO: lock every StockBalance row for this item with available stock, ordered so
      // nearer-expiry batches are consumed first and no-expiry batches are consumed last.
      const balanceRows = await manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .where('balance.itemId = :itemId', { itemId: reqItem.itemId })
        .andWhere('balance.availableQuantity > 0')
        .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
        .setLock('pessimistic_write')
        .getMany();

      const totalAvailable = balanceRows.reduce((sum, row) => sum + Number(row.availableQuantity), 0);
      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `Insufficient stock for item ${reqItem.itemId}: requested ${quantity}, available ${totalAvailable}`,
        );
      }

      let remaining = quantity;
      const transactionRepository = manager.getRepository(StockTransaction);
      for (const balanceRow of balanceRows) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, Number(balanceRow.availableQuantity));

        const updated = await manager.query<Array<{ id: string }>>(
          `
          UPDATE stock_balances
          SET "availableQuantity" = "availableQuantity" - $1
          WHERE id = $2 AND "availableQuantity" >= $1
          RETURNING id
          `,
          [portion, balanceRow.id],
        );
        if (updated.length === 0) {
          throw new Error(
            `Invariant violation: stock balance ${balanceRow.id} changed under lock during fulfillment`,
          );
        }

        await transactionRepository.save(
          transactionRepository.create({
            itemId: reqItem.itemId,
            stockBatchId: balanceRow.stockBatchId,
            transactionType: 'Dispatch',
            referenceId: reqItem.id,
            quantity: String(portion),
            recordedBy: input.fulfilledBy,
          }),
        );

        remaining -= portion;
      }

      reqItem.fulfilledQuantity = String(newFulfilledQuantity);
      const savedReqItem = await reqItemRepository.save(reqItem);

      const siblingItems = await reqItemRepository.find({ where: { requisitionId: requisition.id } });
      const fullyFulfilled = siblingItems.every(
        (line) => Number(line.fulfilledQuantity) >= Number(line.requestedQuantity),
      );
      requisition.status = fullyFulfilled ? 'Fulfilled' : 'PartiallyFulfilled';
      await requisitionRepository.save(requisition);

      return savedReqItem;
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/inventory/inventory-requisition.service.ts
git commit -m "feat(inventory): add FEFO requisition fulfillment"
```

---

### Task 6: Controllers, DTOs, and module wiring

**Files:**
- Create: `apps/api/src/inventory/inventory-requisition.controller.ts`
- Create: `apps/api/src/inventory/inventory-dispatch.controller.ts`
- Create: `apps/api/src/inventory/dto/create-stock-requisition.dto.ts`
- Create: `apps/api/src/inventory/dto/cancel-stock-requisition.dto.ts`
- Create: `apps/api/src/inventory/dto/fulfill-requisition-item.dto.ts`
- Modify: `apps/api/src/inventory/inventory.module.ts`

**Interfaces:**
- Consumes: `InventoryRequisitionService` (Tasks 4-5).

- [ ] **Step 1: Write the DTOs**

`apps/api/src/inventory/dto/create-stock-requisition.dto.ts`:
```ts
export class CreateStockRequisitionItemDto {
  itemId!: string;
  requestedQuantity!: number;
}

export class CreateStockRequisitionDto {
  departmentId!: string;
  requestedBy!: string;
  notes?: string;
  items!: CreateStockRequisitionItemDto[];
}
```

`apps/api/src/inventory/dto/cancel-stock-requisition.dto.ts`:
```ts
export class CancelStockRequisitionDto {
  cancelReason?: string;
}
```

`apps/api/src/inventory/dto/fulfill-requisition-item.dto.ts`:
```ts
export class FulfillRequisitionItemDto {
  quantity!: number;
  fulfilledBy!: string;
}
```

- [ ] **Step 2: Write the requisition controller**

`apps/api/src/inventory/inventory-requisition.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { CreateStockRequisitionDto } from './dto/create-stock-requisition.dto.js';
import { CancelStockRequisitionDto } from './dto/cancel-stock-requisition.dto.js';

@Controller('inventory/requisitions')
@UseGuards(PermissionGuard)
export class InventoryRequisitionController {
  constructor(private readonly inventoryRequisitionService: InventoryRequisitionService) {}

  @Post()
  @RequirePermission('inventory.requisition.create')
  async create(@Body() dto: CreateStockRequisitionDto) {
    return this.inventoryRequisitionService.createRequisition(dto);
  }

  @Get()
  @RequirePermission('inventory.read')
  async listByDepartment(@Query('departmentId') departmentId: string) {
    return this.inventoryRequisitionService.listByDepartment(departmentId);
  }

  @Get(':id')
  @RequirePermission('inventory.read')
  async findOne(@Param('id') id: string) {
    return this.inventoryRequisitionService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermission('inventory.requisition.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelStockRequisitionDto) {
    return this.inventoryRequisitionService.cancel(id, dto.cancelReason);
  }
}
```

- [ ] **Step 3: Write the dispatch controller**

`apps/api/src/inventory/inventory-dispatch.controller.ts`:
```ts
import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { FulfillRequisitionItemDto } from './dto/fulfill-requisition-item.dto.js';

@Controller('inventory/requisitions')
@UseGuards(PermissionGuard)
export class InventoryDispatchController {
  constructor(private readonly inventoryRequisitionService: InventoryRequisitionService) {}

  @Post('items/:stockRequisitionItemId/fulfill')
  @RequirePermission('inventory.dispatch.fulfill')
  async fulfill(
    @Param('stockRequisitionItemId') stockRequisitionItemId: string,
    @Body() dto: FulfillRequisitionItemDto,
  ) {
    return this.inventoryRequisitionService.fulfillRequisitionItem(stockRequisitionItemId, dto);
  }
}
```

Note: two `@Controller` classes may share the same route prefix string (`'inventory/requisitions'`)
— NestJS registers each class's routes independently, so `InventoryRequisitionController`'s
`GET /inventory/requisitions/:id` and `InventoryDispatchController`'s
`POST /inventory/requisitions/items/:stockRequisitionItemId/fulfill` coexist without conflict
(`:id` only matches a single path segment, `items` is a literal segment). No route-ordering
constraint applies here, unlike Item A's `stock-balances`-before-`:id` situation — `items` and any
UUID `:id` never collide since `items` is not a valid UUID.

- [ ] **Step 4: Wire both controllers and the new service into the module**

Modify `apps/api/src/inventory/inventory.module.ts` to match:
```ts
import { Module } from '@nestjs/common';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { InventoryCatalogController } from './inventory-catalog.controller.js';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryProcurementController } from './inventory-procurement.controller.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { InventoryRequisitionService } from './inventory-requisition.service.js';
import { InventoryRequisitionController } from './inventory-requisition.controller.js';
import { InventoryDispatchController } from './inventory-dispatch.controller.js';
import { StockRequisitionNumberGeneratorService } from './stock-requisition-number-generator.service.js';

@Module({
  imports: [MasterDataModule],
  controllers: [
    InventoryCatalogController,
    InventoryProcurementController,
    InventoryRequisitionController,
    InventoryDispatchController,
  ],
  providers: [
    InventoryCatalogService,
    InventoryProcurementService,
    PurchaseOrderNumberGeneratorService,
    InventoryRequisitionService,
    StockRequisitionNumberGeneratorService,
  ],
  exports: [InventoryCatalogService, InventoryProcurementService, InventoryRequisitionService],
})
export class InventoryModule {}
```

This is a full-file replacement of the existing `inventory.module.ts` — the `imports: [MasterDataModule]`
array is new (the module previously had none), required because `InventoryRequisitionService`
injects `MasterDataService` and `MasterDataModule` is not `@Global()`.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inventory/inventory-requisition.controller.ts apps/api/src/inventory/inventory-dispatch.controller.ts apps/api/src/inventory/dto/create-stock-requisition.dto.ts apps/api/src/inventory/dto/cancel-stock-requisition.dto.ts apps/api/src/inventory/dto/fulfill-requisition-item.dto.ts apps/api/src/inventory/inventory.module.ts
git commit -m "feat(inventory): add requisition/dispatch controllers and wire module"
```

---

### Task 7: Documentation updates

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add a Development Standards section**

Add a new `## 17. Inventory Requisition/Dispatch Pipeline` section to
`new/docs/technical-design/Development-Standards.md`, placed after `## 16. Inventory Procurement
Pipeline`, covering: the requisition/fulfillment pattern (department-based requester, no
Store/location dimension); the FEFO batch-walk mechanics and why `.setLock('pessimistic_write')`
on a joined query builder (not `repository.find()`'s `lock` option) is used to lock every matched
`StockBalance` row in one query; the direct arithmetic `UPDATE ... WHERE availableQuantity >= $1`
decrement pattern (contrasted with Item A's `ON CONFLICT` upsert — this table's rows are
guaranteed to already exist, so no upsert is needed, just a guarded decrement); the
numeric-coercion and actor-guard patterns reused verbatim from Item A's own final-review fix; and
the note that `MasterDataModule` had to be added to `InventoryModule`'s `imports` array since it
is not a `@Global()` module (unlike `DatabaseModule`, which every Inventory service relies on
without explicit import).

- [ ] **Step 2: Update the backlog**

In `new/docs/technical-design/pending-tasks.md`, find the existing Inventory Item A sub-bullet
under Phase 6's Phase 2 group (added when Item A shipped) and extend it to also mark Item B done,
naming as **not done**: store-to-store/sub-store routing, multi-level verification/approval
chains, fixed-asset dispatch tracking, "direct dispatch" (bypassing the requisition step), and
manual batch selection (FEFO is the only supported strategy) — each a distinct future item if ever
needed. Note explicitly that with both Item A and Item B complete, Inventory as a whole is
positioned to unblock Pharmacy (the next Phase 6 item that depends on it).

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document Inventory requisition/dispatch pipeline, update Phase 6 backlog status"
```
