# Inventory Module — Item A: Procurement Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inventory module's procurement pipeline (stock IN): item catalog, vendor
master, multi-line purchase orders, goods receipt against PO lines, and an atomically-maintained
stock balance/ledger — the first half of the Inventory domain, following the design in
`new/docs/superpowers/specs/2026-08-05-inventory-procurement-design.md`.

**Architecture:** New domain module `apps/api/src/inventory/`, mirroring the Lab/Radiology
two-controller split: `InventoryCatalogService`/`Controller` (category/sub-category/item/vendor,
create+list only, admin-gated) and `InventoryProcurementService`/`Controller` (purchase order
creation, goods receipt, stock balance query, Inventory/Store Manager-gated). All tenant-scoped
via `TenantConnectionService.runInTenantSchema()`, no `tenantId` column on any entity.

**Tech Stack:** NestJS, TypeORM 1.1.0 + Postgres 16 (schema-per-tenant), pnpm workspace
`apps/api`. No new dependencies.

## Global Constraints

- Table names (snake_case): `inventory_item_categories`, `inventory_item_sub_categories`,
  `inventory_items`, `inventory_vendors`, `purchase_orders`, `purchase_order_items`,
  `stock_batches`, `stock_balances`, `stock_transactions`, `purchase_order_sequences`.
- Migration file: `0022-create-inventory-tables.ts`, class `CreateInventoryTables0022`, `name =
  'CreateInventoryTables00222000000000019'` (continuing the `<ClassName><4-digit-file-number>
  2000000000<order-suffix>` convention — order suffix `019` follows `0021`'s `018`).
- Purchase order number: prefix `'PO'`, atomic `(prefix, year) → lastSequence` sequence table
  (`purchase_order_sequences`), zero-padded 5-digit sequence, format `PO-<year>-<00001>` —
  copies `RadiologyRequisitionNumberGeneratorService`'s pattern exactly.
- No two-phase "unconfirmed" stock staging — goods receipt writes `StockBalance` directly, same
  transaction as the receipt.
- No Store/location dimension — `StockBalance` is keyed on `(itemId, stockBatchId)` only, one
  tenant-wide pool.
- Permissions (nested-dot convention): `inventory.catalog.manage`, `inventory.read`,
  `inventory.purchase-order.create`, `inventory.goods-receipt.enter`. Role `Inventory/Store
  Manager` already exists in `seed-rbac-catalog.ts` with zero permissions — this plan is its
  first-ever grant.
- Catalog scope is create+list only (categories, sub-categories, items, vendors) — no
  update/delete, matching the corrected Lab/Radiology scope.
- Correctness rules carried over from Lab/Radiology's final reviews, applied from the start:
  - No nested `runInTenantSchema()` calls — `PurchaseOrderNumberGeneratorService
    .generateNextPurchaseOrderNumber()` is called *before* `createPurchaseOrder` opens its own
    `runInTenantSchema()`, never inside it.
  - Every mutator that increments a `PurchaseOrderItem.receivedQuantity` takes a
    `pessimistic_write` lock on that row before checking/mutating it.
  - `StockBalance` increments use a single atomic `INSERT ... ON CONFLICT (itemId, stockBatchId)
    DO UPDATE SET "availableQuantity" = "availableQuantity" + excluded."availableQuantity"` —
    never an application-level read-then-write.
  - `StockBatch` find-or-create is atomic via `INSERT ... ON CONFLICT ... DO NOTHING RETURNING
    *` with a `SELECT` fallback on no-op, using **two partial unique indexes** (see Task 1) to
    correctly handle both the has-expiry and no-expiry cases — a plain column-list unique
    constraint on a nullable `expiryDate` would silently permit duplicate no-expiry batches,
    since Postgres treats every `NULL` as distinct for uniqueness purposes.
  - Any `23505` unique-violation catch is scoped to the specific constraint name (via
    `(error as QueryFailedError & { constraint?: string }).constraint === '<exact_name>'`), never
    a bare `error.code === '23505'` check.
  - `PurchaseOrder.status` recomputation reads all sibling `PurchaseOrderItem` rows fresh, within
    the same transaction, after the lock and increment — never trusts a cached line count.

---

### Task 1: Entities and migration

**Files:**
- Create: `apps/api/src/inventory/entities/inventory-item-category.entity.ts`
- Create: `apps/api/src/inventory/entities/inventory-item-sub-category.entity.ts`
- Create: `apps/api/src/inventory/entities/inventory-item.entity.ts`
- Create: `apps/api/src/inventory/entities/inventory-vendor.entity.ts`
- Create: `apps/api/src/inventory/entities/purchase-order.entity.ts`
- Create: `apps/api/src/inventory/entities/purchase-order-item.entity.ts`
- Create: `apps/api/src/inventory/entities/stock-batch.entity.ts`
- Create: `apps/api/src/inventory/entities/stock-balance.entity.ts`
- Create: `apps/api/src/inventory/entities/stock-transaction.entity.ts`
- Create: `apps/api/src/database/migrations/0022-create-inventory-tables.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: all 9 entity classes below, each with the exact field names/types shown — every
  later task imports these verbatim.

- [ ] **Step 1: Write the entity files**

`apps/api/src/inventory/entities/inventory-item-category.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_item_categories')
export class InventoryItemCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'int', default: 0 }) displaySequence!: number;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`apps/api/src/inventory/entities/inventory-item-sub-category.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_item_sub_categories')
export class InventoryItemSubCategory {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) categoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'boolean', default: false }) isConsumable!: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`apps/api/src/inventory/entities/inventory-item.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('inventory_items')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) subCategoryId!: string;
  @Column({ type: 'varchar' }) name!: string;
  @Column({ type: 'varchar' }) code!: string;
  @Column({ type: 'varchar' }) unitOfMeasure!: string;
  @Column({ type: 'numeric', default: 0 }) reorderLevel!: string;
  @Column({ type: 'numeric', default: 0 }) minimumStock!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`apps/api/src/inventory/entities/inventory-vendor.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
```

`apps/api/src/inventory/entities/purchase-order.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
```

`apps/api/src/inventory/entities/purchase-order-item.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
```

`apps/api/src/inventory/entities/stock-batch.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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
```

`apps/api/src/inventory/entities/stock-balance.entity.ts`:
```ts
import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('stock_balances')
export class StockBalance {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'numeric', default: 0 }) availableQuantity!: string;
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt!: Date;
}
```

`apps/api/src/inventory/entities/stock-transaction.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('stock_transactions')
export class StockTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) itemId!: string;
  @Column({ type: 'uuid' }) stockBatchId!: string;
  @Column({ type: 'varchar' }) transactionType!: string; // 'GoodsReceipt'
  @Column({ type: 'uuid', nullable: true }) referenceId!: string | null;
  @Column({ type: 'numeric' }) quantity!: string;
  @Column({ type: 'uuid' }) recordedBy!: string;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt!: Date;
}
```

- [ ] **Step 2: Write the migration**

`apps/api/src/database/migrations/0022-create-inventory-tables.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryTables0022 implements MigrationInterface {
  name = 'CreateInventoryTables00222000000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE inventory_item_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "displaySequence" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE inventory_item_sub_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "categoryId" uuid NOT NULL,
        name varchar NOT NULL,
        "isConsumable" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_item_sub_categories_category_id" ON inventory_item_sub_categories ("categoryId")`,
    );
    await queryRunner.query(`
      CREATE TABLE inventory_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subCategoryId" uuid NOT NULL,
        name varchar NOT NULL,
        code varchar NOT NULL,
        "unitOfMeasure" varchar NOT NULL,
        "reorderLevel" numeric NOT NULL DEFAULT 0,
        "minimumStock" numeric NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_inventory_items_sub_category_id" ON inventory_items ("subCategoryId")`,
    );
    await queryRunner.query(`
      CREATE TABLE inventory_vendors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "contactPerson" varchar NULL,
        phone varchar NULL,
        address varchar NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE purchase_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "vendorId" uuid NOT NULL,
        "purchaseOrderNumber" varchar NOT NULL,
        "orderedBy" uuid NOT NULL,
        "orderedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status varchar NOT NULL DEFAULT 'Ordered',
        notes text NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_purchase_orders_purchase_order_number" UNIQUE ("purchaseOrderNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_purchase_orders_vendor_id" ON purchase_orders ("vendorId")`,
    );
    await queryRunner.query(`
      CREATE TABLE purchase_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "purchaseOrderId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "orderedQuantity" numeric NOT NULL,
        "receivedQuantity" numeric NOT NULL DEFAULT 0,
        "unitCost" numeric NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_purchase_order_items_purchase_order_id" ON purchase_order_items ("purchaseOrderId")`,
    );
    await queryRunner.query(`
      CREATE TABLE stock_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "itemId" uuid NOT NULL,
        "batchNumber" varchar NOT NULL,
        "expiryDate" date NULL,
        "unitCost" numeric NOT NULL,
        mrp numeric NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Two partial unique indexes, not one plain column-list constraint: Postgres treats every
    // NULL as distinct for uniqueness, so a single UNIQUE("itemId","batchNumber","expiryDate")
    // would silently allow duplicate batches whenever expiryDate is NULL (no-expiry items).
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stock_batches_item_batch_expiry"
      ON stock_batches ("itemId", "batchNumber", "expiryDate")
      WHERE "expiryDate" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_stock_batches_item_batch_no_expiry"
      ON stock_batches ("itemId", "batchNumber")
      WHERE "expiryDate" IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE stock_balances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "itemId" uuid NOT NULL,
        "stockBatchId" uuid NOT NULL,
        "availableQuantity" numeric NOT NULL DEFAULT 0,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_stock_balances_item_batch" UNIQUE ("itemId", "stockBatchId")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE stock_transactions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "itemId" uuid NOT NULL,
        "stockBatchId" uuid NOT NULL,
        "transactionType" varchar NOT NULL,
        "referenceId" uuid NULL,
        quantity numeric NOT NULL,
        "recordedBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_stock_transactions_item_id" ON stock_transactions ("itemId")`,
    );
    await queryRunner.query(`
      CREATE TABLE purchase_order_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE purchase_order_sequences`);
    await queryRunner.query(`DROP TABLE stock_transactions`);
    await queryRunner.query(`DROP TABLE stock_balances`);
    await queryRunner.query(`DROP TABLE stock_batches`);
    await queryRunner.query(`DROP TABLE purchase_order_items`);
    await queryRunner.query(`DROP TABLE purchase_orders`);
    await queryRunner.query(`DROP TABLE inventory_vendors`);
    await queryRunner.query(`DROP TABLE inventory_items`);
    await queryRunner.query(`DROP TABLE inventory_item_sub_categories`);
    await queryRunner.query(`DROP TABLE inventory_item_categories`);
  }
}
```

- [ ] **Step 3: Register the migration**

Modify `apps/api/src/database/migrations/index.ts`: add
`import { CreateInventoryTables0022 } from './0022-create-inventory-tables.js';` after the
`AddRadiologyRequisitionReportChecks0021` import, and append `CreateInventoryTables0022` as the
last entry in the `TENANT_MIGRATIONS` array.

- [ ] **Step 4: Register the entities**

Modify `apps/api/src/database/data-source.ts`: add imports for all 9 new entities (mirroring the
existing `RadiologyImagingType`/`RadiologyImagingItem`/`RadiologyRequisition` import block) and
append `InventoryItemCategory, InventoryItemSubCategory, InventoryItem, InventoryVendor,
PurchaseOrder, PurchaseOrderItem, StockBatch, StockBalance, StockTransaction` to the `entities`
array.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inventory/entities apps/api/src/database/migrations/0022-create-inventory-tables.ts apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts
git commit -m "feat(inventory): add Inventory procurement core tables and entities"
```

---

### Task 2: RBAC permissions and role grant

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Consumes: role `'Inventory/Store Manager'` (already present in the file's role list, zero
  permissions).
- Produces: permission names `inventory.catalog.manage`, `inventory.read`,
  `inventory.purchase-order.create`, `inventory.goods-receipt.enter`, used verbatim by
  `@RequirePermission()` in Tasks 4 and 6's controllers.

- [ ] **Step 1: Add the four permissions**

In the permissions array (same array holding `radiology.catalog.manage` etc., immediately after
the Radiology block), add:
```ts
  {
    name: 'inventory.catalog.manage',
    description: 'Create and list inventory item categories, sub-categories, items, and vendors',
  },
  {
    name: 'inventory.read',
    description: 'View inventory catalog, purchase orders, and stock balance',
  },
  {
    name: 'inventory.purchase-order.create',
    description: 'Create a purchase order; also gates cancellation',
  },
  {
    name: 'inventory.goods-receipt.enter',
    description: 'Record a goods receipt against a purchase order line',
  },
```

- [ ] **Step 2: Add the role-permission mappings**

In the role-permission mapping array (same array holding the `radiology.*` mappings, immediately
after them), add:
```ts
  { roleName: 'Super Admin', permissionName: 'inventory.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'inventory.read' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.read' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.read' },
  { roleName: 'Super Admin', permissionName: 'inventory.purchase-order.create' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.purchase-order.create' },
  { roleName: 'Super Admin', permissionName: 'inventory.goods-receipt.enter' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.goods-receipt.enter' },
```

- [ ] **Step 3: Typecheck and run the RBAC seed test suite**

Run: `pnpm exec nx run api:typecheck`
Run: `pnpm exec nx test api --testPathPattern=rbac`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add inventory permissions, wire Inventory/Store Manager's first grants"
```

---

### Task 3: Purchase order number generator

**Files:**
- Create: `apps/api/src/inventory/purchase-order-number-generator.service.ts`
- Modify: `apps/api/src/inventory/inventory.module.ts` (create if not yet present — see Task 6 for
  the final wiring; this task only needs the service to exist and be exported for Task 5 to
  import directly, so a module file is not required until Task 6)

**Interfaces:**
- Produces: `PurchaseOrderNumberGeneratorService.generateNextPurchaseOrderNumber(prefix =
  'PO'): Promise<string>` — called by Task 5's `InventoryProcurementService.createPurchaseOrder`
  *before* it opens its own `runInTenantSchema()`.

- [ ] **Step 1: Write the generator service**

`apps/api/src/inventory/purchase-order-number-generator.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class PurchaseOrderNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextPurchaseOrderNumber(prefix = 'PO'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO purchase_order_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = purchase_order_sequences."lastSequence" + 1
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
git add apps/api/src/inventory/purchase-order-number-generator.service.ts
git commit -m "feat(inventory): add atomic purchase-order-number generator"
```

---

### Task 4: Inventory catalog service and controller

**Files:**
- Create: `apps/api/src/inventory/inventory-catalog.service.ts`
- Create: `apps/api/src/inventory/inventory-catalog.controller.ts`
- Create: `apps/api/src/inventory/dto/create-inventory-item-category.dto.ts`
- Create: `apps/api/src/inventory/dto/create-inventory-item-sub-category.dto.ts`
- Create: `apps/api/src/inventory/dto/create-inventory-item.dto.ts`
- Create: `apps/api/src/inventory/dto/create-inventory-vendor.dto.ts`

**Interfaces:**
- Consumes: `InventoryItemCategory`, `InventoryItemSubCategory`, `InventoryItem`,
  `InventoryVendor` entities from Task 1.
- Produces: `InventoryCatalogService.getItem(id: string): Promise<InventoryItem>` and
  `.getVendor(id: string): Promise<InventoryVendor>` — both throw `NotFoundException` if missing,
  consumed by Task 5's `InventoryProcurementService.createPurchaseOrder`.

- [ ] **Step 1: Write the DTOs**

`apps/api/src/inventory/dto/create-inventory-item-category.dto.ts`:
```ts
export class CreateInventoryItemCategoryDto {
  name!: string;
  displaySequence?: number;
}
```

`apps/api/src/inventory/dto/create-inventory-item-sub-category.dto.ts`:
```ts
export class CreateInventoryItemSubCategoryDto {
  categoryId!: string;
  name!: string;
  isConsumable?: boolean;
}
```

`apps/api/src/inventory/dto/create-inventory-item.dto.ts`:
```ts
export class CreateInventoryItemDto {
  subCategoryId!: string;
  name!: string;
  code!: string;
  unitOfMeasure!: string;
  reorderLevel?: number;
  minimumStock?: number;
}
```

`apps/api/src/inventory/dto/create-inventory-vendor.dto.ts`:
```ts
export class CreateInventoryVendorDto {
  name!: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
}
```

- [ ] **Step 2: Write the catalog service**

`apps/api/src/inventory/inventory-catalog.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { InventoryItemCategory } from './entities/inventory-item-category.entity.js';
import { InventoryItemSubCategory } from './entities/inventory-item-sub-category.entity.js';
import { InventoryItem } from './entities/inventory-item.entity.js';
import { InventoryVendor } from './entities/inventory-vendor.entity.js';

export interface CreateItemCategoryInput {
  name: string;
  displaySequence?: number;
}

export interface CreateItemSubCategoryInput {
  categoryId: string;
  name: string;
  isConsumable?: boolean;
}

export interface CreateItemInput {
  subCategoryId: string;
  name: string;
  code: string;
  unitOfMeasure: string;
  reorderLevel?: number;
  minimumStock?: number;
}

export interface CreateVendorInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

@Injectable()
export class InventoryCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createCategory(input: CreateItemCategoryInput): Promise<InventoryItemCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemCategory);
      return repository.save(
        repository.create({ name: input.name, displaySequence: input.displaySequence ?? 0 }),
      );
    });
  }

  async listCategories(): Promise<InventoryItemCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItemCategory).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async createSubCategory(input: CreateItemSubCategoryInput): Promise<InventoryItemSubCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const category = await manager
        .getRepository(InventoryItemCategory)
        .findOne({ where: { id: input.categoryId } });
      if (!category) {
        throw new NotFoundException(`Inventory item category ${input.categoryId} not found`);
      }

      const repository = manager.getRepository(InventoryItemSubCategory);
      return repository.save(
        repository.create({
          categoryId: input.categoryId,
          name: input.name,
          isConsumable: input.isConsumable ?? false,
        }),
      );
    });
  }

  async listSubCategoriesByCategory(categoryId: string): Promise<InventoryItemSubCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItemSubCategory).find({ where: { categoryId } }),
    );
  }

  async createItem(input: CreateItemInput): Promise<InventoryItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const subCategory = await manager
        .getRepository(InventoryItemSubCategory)
        .findOne({ where: { id: input.subCategoryId } });
      if (!subCategory) {
        throw new NotFoundException(`Inventory item sub-category ${input.subCategoryId} not found`);
      }

      const repository = manager.getRepository(InventoryItem);
      return repository.save(
        repository.create({
          subCategoryId: input.subCategoryId,
          name: input.name,
          code: input.code,
          unitOfMeasure: input.unitOfMeasure,
          reorderLevel: input.reorderLevel ?? 0,
          minimumStock: input.minimumStock ?? 0,
        }),
      );
    });
  }

  async listItemsBySubCategory(subCategoryId: string): Promise<InventoryItem[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItem).find({ where: { subCategoryId } }),
    );
  }

  async getItem(id: string): Promise<InventoryItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.getRepository(InventoryItem).findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      return item;
    });
  }

  async createVendor(input: CreateVendorInput): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryVendor);
      return repository.save(
        repository.create({
          name: input.name,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
        }),
      );
    });
  }

  async listVendors(): Promise<InventoryVendor[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryVendor).find({ order: { name: 'ASC' } }),
    );
  }

  async getVendor(id: string): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const vendor = await manager.getRepository(InventoryVendor).findOne({ where: { id } });
      if (!vendor) {
        throw new NotFoundException(`Inventory vendor ${id} not found`);
      }
      return vendor;
    });
  }
}
```

- [ ] **Step 3: Write the catalog controller**

`apps/api/src/inventory/inventory-catalog.controller.ts`:
```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { CreateInventoryItemCategoryDto } from './dto/create-inventory-item-category.dto.js';
import { CreateInventoryItemSubCategoryDto } from './dto/create-inventory-item-sub-category.dto.js';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto.js';
import { CreateInventoryVendorDto } from './dto/create-inventory-vendor.dto.js';

@Controller('inventory')
@UseGuards(PermissionGuard)
export class InventoryCatalogController {
  constructor(private readonly inventoryCatalogService: InventoryCatalogService) {}

  @Post('categories')
  @RequirePermission('inventory.catalog.manage')
  async createCategory(@Body() dto: CreateInventoryItemCategoryDto) {
    return this.inventoryCatalogService.createCategory(dto);
  }

  @Get('categories')
  @RequirePermission('inventory.read')
  async listCategories() {
    return this.inventoryCatalogService.listCategories();
  }

  @Post('sub-categories')
  @RequirePermission('inventory.catalog.manage')
  async createSubCategory(@Body() dto: CreateInventoryItemSubCategoryDto) {
    return this.inventoryCatalogService.createSubCategory(dto);
  }

  @Get('categories/:categoryId/sub-categories')
  @RequirePermission('inventory.read')
  async listSubCategoriesByCategory(@Param('categoryId') categoryId: string) {
    return this.inventoryCatalogService.listSubCategoriesByCategory(categoryId);
  }

  @Post('items')
  @RequirePermission('inventory.catalog.manage')
  async createItem(@Body() dto: CreateInventoryItemDto) {
    return this.inventoryCatalogService.createItem(dto);
  }

  @Get('sub-categories/:subCategoryId/items')
  @RequirePermission('inventory.read')
  async listItemsBySubCategory(@Param('subCategoryId') subCategoryId: string) {
    return this.inventoryCatalogService.listItemsBySubCategory(subCategoryId);
  }

  @Get('items/:id')
  @RequirePermission('inventory.read')
  async getItem(@Param('id') id: string) {
    return this.inventoryCatalogService.getItem(id);
  }

  @Post('vendors')
  @RequirePermission('inventory.catalog.manage')
  async createVendor(@Body() dto: CreateInventoryVendorDto) {
    return this.inventoryCatalogService.createVendor(dto);
  }

  @Get('vendors')
  @RequirePermission('inventory.read')
  async listVendors() {
    return this.inventoryCatalogService.listVendors();
  }

  @Get('vendors/:id')
  @RequirePermission('inventory.read')
  async getVendor(@Param('id') id: string) {
    return this.inventoryCatalogService.getVendor(id);
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS. (The controller is not yet wired into any module — that's fine, Task 6 does the
module/app wiring for both controllers together. Typecheck does not require module wiring.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/inventory/inventory-catalog.service.ts apps/api/src/inventory/inventory-catalog.controller.ts apps/api/src/inventory/dto/create-inventory-item-category.dto.ts apps/api/src/inventory/dto/create-inventory-item-sub-category.dto.ts apps/api/src/inventory/dto/create-inventory-item.dto.ts apps/api/src/inventory/dto/create-inventory-vendor.dto.ts
git commit -m "feat(inventory): add inventory catalog service and controller"
```

---

### Task 5: Purchase order creation

**Files:**
- Create: `apps/api/src/inventory/inventory-procurement.service.ts`

**Interfaces:**
- Consumes: `PurchaseOrderNumberGeneratorService.generateNextPurchaseOrderNumber()` (Task 3),
  `InventoryCatalogService.getVendor(id)` / `.getItem(id)` (Task 4), `PurchaseOrder` /
  `PurchaseOrderItem` entities (Task 1).
- Produces: `InventoryProcurementService.createPurchaseOrder(input: CreatePurchaseOrderInput):
  Promise<PurchaseOrder & { items: PurchaseOrderItem[] }>`, `.findOne(id: string): Promise<...>`,
  `.listByVendor(vendorId: string): Promise<PurchaseOrder[]>`, `.cancel(id: string, cancelReason?:
  string): Promise<PurchaseOrder>` — all consumed by Task 7's controller. Task 6 adds
  `recordGoodsReceipt` and `listStockBalances` to this same service/file.

- [ ] **Step 1: Write the service (creation, read, cancel)**

`apps/api/src/inventory/inventory-procurement.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PurchaseOrder } from './entities/purchase-order.entity.js';
import { PurchaseOrderItem } from './entities/purchase-order-item.entity.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';
import { InventoryCatalogService } from './inventory-catalog.service.js';

export interface CreatePurchaseOrderItemInput {
  itemId: string;
  orderedQuantity: number;
  unitCost: number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  orderedBy: string;
  notes?: string;
  items: CreatePurchaseOrderItemInput[];
}

const NON_TERMINAL_PO_STATUSES = ['Ordered', 'PartiallyReceived'];

@Injectable()
export class InventoryProcurementService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly purchaseOrderNumberGenerator: PurchaseOrderNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
  ) {}

  async createPurchaseOrder(
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrder & { items: PurchaseOrderItem[] }> {
    if (!input.items || input.items.length === 0) {
      throw new BadRequestException('A purchase order must include at least one item');
    }
    for (const line of input.items) {
      if (line.orderedQuantity <= 0) {
        throw new BadRequestException(`Item ${line.itemId} must have a positive orderedQuantity`);
      }
      if (line.unitCost < 0) {
        throw new BadRequestException(`Item ${line.itemId} has a negative unitCost`);
      }
    }

    await this.inventoryCatalogService.getVendor(input.vendorId); // throws NotFoundException if missing
    for (const line of input.items) {
      await this.inventoryCatalogService.getItem(line.itemId); // throws NotFoundException if missing
    }

    const purchaseOrderNumber = await this.purchaseOrderNumberGenerator.generateNextPurchaseOrderNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const purchaseOrderRepository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await purchaseOrderRepository.save(
        purchaseOrderRepository.create({
          vendorId: input.vendorId,
          purchaseOrderNumber,
          orderedBy: input.orderedBy,
          notes: input.notes ?? null,
          status: 'Ordered',
        }),
      );

      const itemRepository = manager.getRepository(PurchaseOrderItem);
      const items = await itemRepository.save(
        input.items.map((line) =>
          itemRepository.create({
            purchaseOrderId: purchaseOrder.id,
            itemId: line.itemId,
            orderedQuantity: line.orderedQuantity,
            unitCost: line.unitCost,
          }),
        ),
      );

      return { ...purchaseOrder, items };
    });
  }

  async findOne(id: string): Promise<PurchaseOrder & { items: PurchaseOrderItem[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const purchaseOrder = await manager.getRepository(PurchaseOrder).findOne({ where: { id } });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      const items = await manager
        .getRepository(PurchaseOrderItem)
        .find({ where: { purchaseOrderId: id }, order: { createdAt: 'ASC' } });
      return { ...purchaseOrder, items };
    });
  }

  async listByVendor(vendorId: string): Promise<PurchaseOrder[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(PurchaseOrder).find({ where: { vendorId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<PurchaseOrder> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${id} not found`);
      }
      if (purchaseOrder.status !== 'Ordered') {
        throw new ConflictException(
          `Purchase order ${id} can only be cancelled while status is Ordered (current: ${purchaseOrder.status})`,
        );
      }

      purchaseOrder.status = 'Cancelled';
      purchaseOrder.cancelReason = cancelReason ?? null;
      return repository.save(purchaseOrder);
    });
  }
}
```

Note: `NON_TERMINAL_PO_STATUSES` is unused by this task's methods — it's declared here because
Task 6 references it when validating goods receipt eligibility. Leaving it in this file (rather
than redeclaring it in Task 6) avoids a duplicate constant; Task 6's diff will show it coming into
use.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS. (`NON_TERMINAL_PO_STATUSES` being unused at this point is fine — TypeScript does
not error on an unused top-level `const` unless `noUnusedLocals` targets module-level bindings,
which this repo's config does not; confirm with the typecheck run, not by assumption.)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/inventory/inventory-procurement.service.ts
git commit -m "feat(inventory): add purchase order creation, read, and cancel"
```

---

### Task 6: Goods receipt and stock balance

**Files:**
- Modify: `apps/api/src/inventory/inventory-procurement.service.ts`

**Interfaces:**
- Consumes: `StockBatch`, `StockBalance`, `StockTransaction`, `PurchaseOrderItem` entities (Task
  1); `NON_TERMINAL_PO_STATUSES` constant (Task 5, same file).
- Produces: `InventoryProcurementService.recordGoodsReceipt(purchaseOrderItemId: string, input:
  RecordGoodsReceiptInput): Promise<PurchaseOrderItem>` and `.listStockBalances(itemId?: string):
  Promise<StockBalanceView[]>` — both consumed by Task 7's controller.

- [ ] **Step 1: Add the goods receipt and stock balance methods**

Add these imports to the top of `apps/api/src/inventory/inventory-procurement.service.ts`
(alongside the existing ones from Task 5):
```ts
import { IsNull, QueryFailedError } from 'typeorm';
import { StockBatch } from './entities/stock-batch.entity.js';
import { StockBalance } from './entities/stock-balance.entity.js';
import { StockTransaction } from './entities/stock-transaction.entity.js';
```

Add this interface near the top of the file, alongside `CreatePurchaseOrderInput`:
```ts
export interface RecordGoodsReceiptInput {
  batchNumber: string;
  expiryDate?: string;
  unitCost: number;
  mrp?: number;
  receivedQuantity: number;
  recordedBy: string;
}

export interface StockBalanceView {
  itemId: string;
  stockBatchId: string;
  batchNumber: string;
  expiryDate: string | null;
  availableQuantity: string;
}
```

Add these two methods to the `InventoryProcurementService` class, after `cancel`:
```ts
  async recordGoodsReceipt(
    purchaseOrderItemId: string,
    input: RecordGoodsReceiptInput,
  ): Promise<PurchaseOrderItem> {
    if (input.receivedQuantity <= 0) {
      throw new BadRequestException('receivedQuantity must be positive');
    }
    if (input.unitCost < 0) {
      throw new BadRequestException('unitCost cannot be negative');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const poItemRepository = manager.getRepository(PurchaseOrderItem);
      const poItem = await poItemRepository.findOne({
        where: { id: purchaseOrderItemId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!poItem) {
        throw new NotFoundException(`Purchase order item ${purchaseOrderItemId} not found`);
      }

      const purchaseOrderRepository = manager.getRepository(PurchaseOrder);
      const purchaseOrder = await purchaseOrderRepository.findOne({
        where: { id: poItem.purchaseOrderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!purchaseOrder) {
        throw new NotFoundException(`Purchase order ${poItem.purchaseOrderId} not found`);
      }
      if (!NON_TERMINAL_PO_STATUSES.includes(purchaseOrder.status)) {
        throw new ConflictException(
          `Purchase order ${purchaseOrder.id} cannot receive goods from status ${purchaseOrder.status}`,
        );
      }

      const newReceivedQuantity = Number(poItem.receivedQuantity) + input.receivedQuantity;
      if (newReceivedQuantity > Number(poItem.orderedQuantity)) {
        throw new BadRequestException(
          `Receiving ${input.receivedQuantity} would exceed the ordered quantity for line ${purchaseOrderItemId} ` +
            `(ordered: ${poItem.orderedQuantity}, already received: ${poItem.receivedQuantity})`,
        );
      }

      const stockBatch = await this.findOrCreateStockBatch(manager, {
        itemId: poItem.itemId,
        batchNumber: input.batchNumber,
        expiryDate: input.expiryDate ?? null,
        unitCost: input.unitCost,
        mrp: input.mrp ?? null,
      });

      await manager.getRepository(StockTransaction).save(
        manager.getRepository(StockTransaction).create({
          itemId: poItem.itemId,
          stockBatchId: stockBatch.id,
          transactionType: 'GoodsReceipt',
          referenceId: poItem.id,
          quantity: input.receivedQuantity,
          recordedBy: input.recordedBy,
        }),
      );

      await manager.query(
        `
        INSERT INTO stock_balances ("itemId", "stockBatchId", "availableQuantity")
        VALUES ($1, $2, $3)
        ON CONFLICT ("itemId", "stockBatchId")
        DO UPDATE SET "availableQuantity" = stock_balances."availableQuantity" + excluded."availableQuantity"
        `,
        [poItem.itemId, stockBatch.id, input.receivedQuantity],
      );

      poItem.receivedQuantity = String(newReceivedQuantity);
      const savedPoItem = await poItemRepository.save(poItem);

      const siblingItems = await poItemRepository.find({ where: { purchaseOrderId: purchaseOrder.id } });
      const fullyReceived = siblingItems.every(
        (line) => Number(line.receivedQuantity) >= Number(line.orderedQuantity),
      );
      purchaseOrder.status = fullyReceived ? 'Received' : 'PartiallyReceived';
      await purchaseOrderRepository.save(purchaseOrder);

      return savedPoItem;
    });
  }

  private async findOrCreateStockBatch(
    manager: import('typeorm').EntityManager,
    input: { itemId: string; batchNumber: string; expiryDate: string | null; unitCost: number; mrp: number | null },
  ): Promise<StockBatch> {
    const repository = manager.getRepository(StockBatch);

    try {
      if (input.expiryDate === null) {
        const inserted = await manager.query(
          `
          INSERT INTO stock_batches ("itemId", "batchNumber", "expiryDate", "unitCost", mrp)
          VALUES ($1, $2, NULL, $3, $4)
          ON CONFLICT ("itemId", "batchNumber") WHERE "expiryDate" IS NULL DO NOTHING
          RETURNING *
          `,
          [input.itemId, input.batchNumber, input.unitCost, input.mrp],
        );
        if (inserted.length > 0) {
          return repository.create(inserted[0]);
        }
        const existing = await repository.findOne({
          where: { itemId: input.itemId, batchNumber: input.batchNumber, expiryDate: IsNull() },
        });
        if (!existing) {
          throw new ConflictException(
            `Stock batch race for item ${input.itemId} / batch ${input.batchNumber} (no expiry) could not be resolved`,
          );
        }
        return existing;
      }

      const inserted = await manager.query(
        `
        INSERT INTO stock_batches ("itemId", "batchNumber", "expiryDate", "unitCost", mrp)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("itemId", "batchNumber", "expiryDate") WHERE "expiryDate" IS NOT NULL DO NOTHING
        RETURNING *
        `,
        [input.itemId, input.batchNumber, input.expiryDate, input.unitCost, input.mrp],
      );
      if (inserted.length > 0) {
        return repository.create(inserted[0]);
      }
      const existing = await repository.findOne({
        where: { itemId: input.itemId, batchNumber: input.batchNumber, expiryDate: input.expiryDate },
      });
      if (!existing) {
        throw new ConflictException(
          `Stock batch race for item ${input.itemId} / batch ${input.batchNumber} / expiry ${input.expiryDate} could not be resolved`,
        );
      }
      return existing;
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        ((error as QueryFailedError & { constraint?: string }).constraint === 'UQ_stock_batches_item_batch_expiry' ||
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_stock_batches_item_batch_no_expiry')
      ) {
        const existing = await repository.findOne({
          where: {
            itemId: input.itemId,
            batchNumber: input.batchNumber,
            expiryDate: input.expiryDate === null ? IsNull() : input.expiryDate,
          },
        });
        if (existing) return existing;
      }
      throw error;
    }
  }

  async listStockBalances(itemId?: string): Promise<StockBalanceView[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const query = manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .select('balance.itemId', 'itemId')
        .addSelect('balance.stockBatchId', 'stockBatchId')
        .addSelect('batch.batchNumber', 'batchNumber')
        .addSelect('batch.expiryDate', 'expiryDate')
        .addSelect('balance.availableQuantity', 'availableQuantity');
      if (itemId) {
        query.where('balance.itemId = :itemId', { itemId });
      }
      return query.getRawMany<StockBalanceView>();
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/inventory/inventory-procurement.service.ts
git commit -m "feat(inventory): add goods receipt and stock balance query"
```

---

### Task 7: Procurement controller, DTOs, and module wiring

**Files:**
- Create: `apps/api/src/inventory/inventory-procurement.controller.ts`
- Create: `apps/api/src/inventory/dto/create-purchase-order.dto.ts`
- Create: `apps/api/src/inventory/dto/record-goods-receipt.dto.ts`
- Create: `apps/api/src/inventory/dto/cancel-purchase-order.dto.ts`
- Create: `apps/api/src/inventory/inventory.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `InventoryProcurementService` (Tasks 5-6), `InventoryCatalogService` (Task 4),
  `PurchaseOrderNumberGeneratorService` (Task 3).

- [ ] **Step 1: Write the DTOs**

`apps/api/src/inventory/dto/create-purchase-order.dto.ts`:
```ts
export class CreatePurchaseOrderItemDto {
  itemId!: string;
  orderedQuantity!: number;
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  vendorId!: string;
  orderedBy!: string;
  notes?: string;
  items!: CreatePurchaseOrderItemDto[];
}
```

`apps/api/src/inventory/dto/record-goods-receipt.dto.ts`:
```ts
export class RecordGoodsReceiptDto {
  batchNumber!: string;
  expiryDate?: string;
  unitCost!: number;
  mrp?: number;
  receivedQuantity!: number;
  recordedBy!: string;
}
```

`apps/api/src/inventory/dto/cancel-purchase-order.dto.ts`:
```ts
export class CancelPurchaseOrderDto {
  cancelReason?: string;
}
```

- [ ] **Step 2: Write the procurement controller**

`apps/api/src/inventory/inventory-procurement.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { RecordGoodsReceiptDto } from './dto/record-goods-receipt.dto.js';
import { CancelPurchaseOrderDto } from './dto/cancel-purchase-order.dto.js';

@Controller('inventory/purchase-orders')
@UseGuards(PermissionGuard)
export class InventoryProcurementController {
  constructor(private readonly inventoryProcurementService: InventoryProcurementService) {}

  @Post()
  @RequirePermission('inventory.purchase-order.create')
  async create(@Body() dto: CreatePurchaseOrderDto) {
    return this.inventoryProcurementService.createPurchaseOrder(dto);
  }

  @Get()
  @RequirePermission('inventory.read')
  async listByVendor(@Query('vendorId') vendorId: string) {
    return this.inventoryProcurementService.listByVendor(vendorId);
  }

  @Get('stock-balances')
  @RequirePermission('inventory.read')
  async listStockBalances(@Query('itemId') itemId?: string) {
    return this.inventoryProcurementService.listStockBalances(itemId);
  }

  @Get(':id')
  @RequirePermission('inventory.read')
  async findOne(@Param('id') id: string) {
    return this.inventoryProcurementService.findOne(id);
  }

  @Patch(':id/cancel')
  @RequirePermission('inventory.purchase-order.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelPurchaseOrderDto) {
    return this.inventoryProcurementService.cancel(id, dto.cancelReason);
  }

  @Post('items/:purchaseOrderItemId/goods-receipt')
  @RequirePermission('inventory.goods-receipt.enter')
  async recordGoodsReceipt(
    @Param('purchaseOrderItemId') purchaseOrderItemId: string,
    @Body() dto: RecordGoodsReceiptDto,
  ) {
    return this.inventoryProcurementService.recordGoodsReceipt(purchaseOrderItemId, dto);
  }
}
```

Note: `GET /inventory/purchase-orders/stock-balances` is declared **before**
`GET /inventory/purchase-orders/:id` — NestJS matches routes in registration order, so the
literal `stock-balances` path must precede the `:id` wildcard or every stock-balance request would
incorrectly match `findOne` with `id = 'stock-balances'`.

- [ ] **Step 3: Write the module**

`apps/api/src/inventory/inventory.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { InventoryCatalogService } from './inventory-catalog.service.js';
import { InventoryCatalogController } from './inventory-catalog.controller.js';
import { InventoryProcurementService } from './inventory-procurement.service.js';
import { InventoryProcurementController } from './inventory-procurement.controller.js';
import { PurchaseOrderNumberGeneratorService } from './purchase-order-number-generator.service.js';

@Module({
  controllers: [InventoryCatalogController, InventoryProcurementController],
  providers: [InventoryCatalogService, InventoryProcurementService, PurchaseOrderNumberGeneratorService],
  exports: [InventoryCatalogService, InventoryProcurementService],
})
export class InventoryModule {}
```

- [ ] **Step 4: Wire the module into the app**

Modify `apps/api/src/app/app.module.ts`: add
`import { InventoryModule } from '../inventory/inventory.module.js';` after the `RadiologyModule`
import, and add `InventoryModule` after `RadiologyModule` in the `imports` array.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/inventory/inventory-procurement.controller.ts apps/api/src/inventory/dto/create-purchase-order.dto.ts apps/api/src/inventory/dto/record-goods-receipt.dto.ts apps/api/src/inventory/dto/cancel-purchase-order.dto.ts apps/api/src/inventory/inventory.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(inventory): add procurement controller and wire inventory module"
```

---

### Task 8: Documentation updates

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add a Development Standards section**

Add a new `## 16. Inventory Procurement Pipeline` section to
`new/docs/technical-design/Development-Standards.md`, placed after `## 15. Radiology Core
Pipeline`, covering: the catalog/PO/goods-receipt/stock-balance pattern; the two-partial-unique-
index approach for `stock_batches` (documenting the NULL-uniqueness pitfall it avoids, so future
modules with a similar "batch identity with an optional field" shape don't repeat the mistake);
the atomic `ON CONFLICT ... DO UPDATE SET x = x + excluded.x` pattern for `stock_balances`; the
explicit scope cut (catalog is create+list only, no two-phase staging, no store/location
dimension); and a pointer to Item B (requisition/dispatch) as the follow-up that will read from
this pipeline's stock balance.

- [ ] **Step 2: Update the backlog**

In `new/docs/technical-design/pending-tasks.md`, under Phase 6's Phase 2 group, replace the
`Inventory` mention in the `- DICOM, Pharmacy, Inventory, Ward Supply — not started` line with a
new `[x] Inventory Item A — procurement pipeline` sub-item (mirroring the Lab/Radiology sub-item
format), naming as **not done**: RFQ/Quotation, two-phase unconfirmed stock staging, store/
location dimension, vendor accounting fields, donations/returns/write-offs, multi-store/currency/
fiscal-year masters, formal PO approval workflow, and — the immediate next follow-up — **Item B:
internal requisition/dispatch (stock OUT)**, the dependency Pharmacy needs. Leave `DICOM,
Pharmacy, Ward Supply — not started` as the remaining unstarted line.

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document Inventory procurement pipeline, update Phase 6 backlog status"
```
