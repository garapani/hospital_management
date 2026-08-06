# Pharmacy Prescription Dispensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Pharmacy module's prescription dispensing pipeline: reclassifying a Pharmacy
`OrderItem` against a catalog `InventoryItem`, then dispensing — which decrements stock via the
same FEFO mechanics Inventory Item B already proved out — following
`new/docs/superpowers/specs/2026-08-06-pharmacy-dispensing-design.md`.

**Architecture:** New domain module `apps/api/src/pharmacy/`, a single service/controller pair
(`PharmacyDispensingService`/`PharmacyDispensingController` — no catalog/workflow split, since the
catalog is Inventory's, already built). `PharmacyModule` imports `InventoryModule` (already
exports `InventoryCatalogService`) for drug-existence validation, and directly imports Inventory's
`StockBalance`/`StockBatch`/`StockTransaction` entity classes to re-implement Item B's FEFO walk as
its own copy (this codebase's established convention: mirror a proven pattern, don't extract a
shared abstraction — every number-generator service in this codebase is its own near-identical
copy, not a shared one). All tenant-scoped via `TenantConnectionService.runInTenantSchema()`.

**Tech Stack:** NestJS, TypeORM 1.1.0 + Postgres 16 (schema-per-tenant), pnpm workspace
`apps/api`. No new dependencies.

## Global Constraints

- Table names (snake_case): `pharmacy_dispensings`, `pharmacy_dispensing_sequences`.
- Migration file: `0024-create-pharmacy-tables.ts`, class `CreatePharmacyTables0024`, `name =
  'CreatePharmacyTables00242000000000021'` (continuing the `<ClassName><4-digit-file-number>
  2000000000<order-suffix>` convention — order suffix `021` follows `0023`'s `020`).
- Dispensing number: prefix `'RX'`, atomic `(prefix, year) → lastSequence` sequence table
  (`pharmacy_dispensing_sequences`), zero-padded 5-digit sequence, format `RX-<year>-<00001>` —
  copies `StockRequisitionNumberGeneratorService`'s pattern exactly.
- No separate catalog — a drug is just an existing `InventoryItem`. No new entity, no extension to
  `InventoryItem`.
- No separate verification step — dispensing moves straight from `'Pending'` to `'Dispensed'`.
- Duplicate-dispensing race prevention baked in from day one (not a follow-up fix, unlike Lab/LIS's
  original mistake): the existing-dispensing check filters `status != 'Cancelled'` (TypeORM
  `Not('Cancelled')`), and the initial migration includes a partial unique index (`CREATE UNIQUE
  INDEX ... ON pharmacy_dispensings ("orderItemId") WHERE status <> 'Cancelled'`) from the start.
- `PharmacyDispensingNumberGeneratorService.generateNextDispensingNumber()` and
  `InventoryCatalogService.getItem()` are both called *before* `createDispensing` opens its own
  `runInTenantSchema()` — never nested inside it.
- `dispenseDrug` takes a `pessimistic_write` lock on the `PharmacyDispensing` row before checking
  status.
- FEFO walk mirrors `InventoryRequisitionService.fulfillRequisitionItem`'s final, fixed shape
  exactly: `StockBalance` rows locked via a query builder joined to `StockBatch`, lock scoped to
  `.setLock('pessimistic_write', undefined, ['balance'])` (not a bare `.setLock('pessimistic_write')`,
  which would over-lock the joined `stock_batches` table too), ordered `batch.expiryDate ASC NULLS
  LAST` tie-broken by `batch.createdAt ASC` then `balance.id ASC`, insufficient-stock rejected
  before any write, each per-batch decrement a guarded `UPDATE stock_balances SET
  "availableQuantity" = "availableQuantity" - $1, "updatedAt" = now() WHERE id = $2 AND
  "availableQuantity" >= $1 RETURNING id` whose result is read as the `[rows, rowCount]` **tuple**
  this codebase's TypeORM version returns for `UPDATE ... RETURNING` (checking `result[1] === 0`,
  **never** `result.length`, which is always 2 regardless of whether any row matched — this exact
  mistake shipped once in Item B and was fixed in commit `3da4353`; do not repeat it here), and a
  post-loop `if (remaining > 0) throw new Error(...)` invariant after the walk completes.
- `stock_transactions.transactionType` gets a third value: `'PharmacyDispense'` (no schema
  change — the column is already a plain `varchar`). `referenceId` points to the
  `PharmacyDispensing.id`.
- Every client-supplied numeric field (`quantity`) is validated with `typeof x !== 'number' ||
  !Number.isFinite(x) || x <= 0` before any arithmetic or storage.
- Every client-supplied actor field (`dispensedBy`) is guarded with `!x?.trim()` →
  `BadRequestException`, before any database write.
- Cancel is valid only from `'Pending'` — mirrors every prior module's cancel-before-any-stock-
  movement rule.

---

### Task 1: Entity and migration

**Files:**
- Create: `apps/api/src/pharmacy/entities/pharmacy-dispensing.entity.ts`
- Create: `apps/api/src/database/migrations/0024-create-pharmacy-tables.ts`
- Modify: `apps/api/src/database/migrations/index.ts`
- Modify: `apps/api/src/database/data-source.ts`

**Interfaces:**
- Produces: `PharmacyDispensing` entity class, exact field names/types below — every later task
  imports this verbatim.

- [ ] **Step 1: Write the entity file**

`apps/api/src/pharmacy/entities/pharmacy-dispensing.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

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

- [ ] **Step 2: Write the migration**

`apps/api/src/database/migrations/0024-create-pharmacy-tables.ts`:
```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePharmacyTables0024 implements MigrationInterface {
  name = 'CreatePharmacyTables00242000000000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE pharmacy_dispensings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "orderItemId" uuid NOT NULL,
        "inventoryItemId" uuid NOT NULL,
        "dispensingNumber" varchar NOT NULL,
        quantity numeric NOT NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "dispensedBy" uuid NULL,
        "dispensedAt" timestamptz NULL,
        "cancelReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_pharmacy_dispensings_dispensing_number" UNIQUE ("dispensingNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pharmacy_dispensings_order_item_id" ON pharmacy_dispensings ("orderItemId")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pharmacy_dispensings_active_order_item"
      ON pharmacy_dispensings ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
    await queryRunner.query(`
      CREATE TABLE pharmacy_dispensing_sequences (
        prefix varchar(20) NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL DEFAULT 0,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE pharmacy_dispensing_sequences`);
    await queryRunner.query(`DROP INDEX "UQ_pharmacy_dispensings_active_order_item"`);
    await queryRunner.query(`DROP TABLE pharmacy_dispensings`);
  }
}
```

- [ ] **Step 3: Register the migration**

Modify `apps/api/src/database/migrations/index.ts`: add
`import { CreatePharmacyTables0024 } from './0024-create-pharmacy-tables.js';` after the
`CreateInventoryRequisitionTables0023` import, and append `CreatePharmacyTables0024` as the last
entry in the `TENANT_MIGRATIONS` array.

- [ ] **Step 4: Register the entity**

Modify `apps/api/src/database/data-source.ts`: add an import for `PharmacyDispensing` (mirroring
the existing `../inventory/entities/*.entity.js` import block) and append `PharmacyDispensing` to
the `entities` array.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pharmacy/entities/pharmacy-dispensing.entity.ts apps/api/src/database/migrations/0024-create-pharmacy-tables.ts apps/api/src/database/migrations/index.ts apps/api/src/database/data-source.ts
git commit -m "feat(pharmacy): add pharmacy dispensing core table and entity"
```

---

### Task 2: RBAC permissions and role grants

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Consumes: role `'Pharmacist'` (already exists in the role catalog with zero permissions —
  this item is its first-ever grant); role `'Doctor'` (already exists, already holds several
  other `.read` permissions).
- Produces: permission names `pharmacy.read`, `pharmacy.dispensing.create`,
  `pharmacy.dispensing.dispense`, used verbatim by `@RequirePermission()` in Task 6's controller.

- [ ] **Step 1: Add the three permissions**

In the `PERMISSION_CATALOG` array, immediately after the existing `inventory.dispatch.fulfill`
entry, add:
```ts
  {
    name: 'pharmacy.read',
    description: 'View pharmacy dispensing records',
  },
  {
    name: 'pharmacy.dispensing.create',
    description: 'Create a pharmacy dispensing record from an order item; also gates cancellation',
  },
  {
    name: 'pharmacy.dispensing.dispense',
    description: 'Dispense against a pharmacy dispensing record, decrementing stock',
  },
```

- [ ] **Step 2: Add the role-permission mappings**

In the role-permission mapping array, immediately after the existing
`{ roleName: 'Inventory/Store Manager', permissionName: 'inventory.dispatch.fulfill' }` line, add:
```ts
  { roleName: 'Super Admin', permissionName: 'pharmacy.read' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.read' },
  { roleName: 'Doctor', permissionName: 'pharmacy.read' },
  { roleName: 'Super Admin', permissionName: 'pharmacy.dispensing.create' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.dispensing.create' },
  { roleName: 'Super Admin', permissionName: 'pharmacy.dispensing.dispense' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.dispensing.dispense' },
```

- [ ] **Step 3: Typecheck and run the RBAC seed test suite**

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Run: `pnpm exec nx test api --testPathPattern=rbac`
Expected: typecheck PASS. The test run may report `UNABLE_TO_RUN` if no local Postgres is
available in this environment — that is a genuine pre-existing environmental limitation (confirmed
repeatedly throughout this project's history), not a blocker; do not treat it as a failure.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add pharmacy permissions, wire Pharmacist's first grants"
```

---

### Task 3: Dispensing number generator

**Files:**
- Create: `apps/api/src/pharmacy/pharmacy-dispensing-number-generator.service.ts`

**Interfaces:**
- Produces: `PharmacyDispensingNumberGeneratorService.generateNextDispensingNumber(prefix =
  'RX'): Promise<string>` — called by Task 4's `PharmacyDispensingService.createDispensing`
  *before* it opens its own `runInTenantSchema()`.

- [ ] **Step 1: Write the generator service**

`apps/api/src/pharmacy/pharmacy-dispensing-number-generator.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

@Injectable()
export class PharmacyDispensingNumberGeneratorService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async generateNextDispensingNumber(prefix = 'RX'): Promise<string> {
    const currentYear = new Date().getFullYear();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const result = await manager.query(
        `
        INSERT INTO pharmacy_dispensing_sequences (prefix, year, "lastSequence")
        VALUES ($1, $2, 1)
        ON CONFLICT (prefix, year)
        DO UPDATE SET "lastSequence" = pharmacy_dispensing_sequences."lastSequence" + 1
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

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/pharmacy/pharmacy-dispensing-number-generator.service.ts
git commit -m "feat(pharmacy): add atomic dispensing-number generator"
```

---

### Task 4: Dispensing creation, read, and cancel

**Files:**
- Create: `apps/api/src/pharmacy/pharmacy-dispensing.service.ts`

**Interfaces:**
- Consumes: `PharmacyDispensingNumberGeneratorService.generateNextDispensingNumber()` (Task 3),
  `InventoryCatalogService.getItem(id)` (already exists at
  `apps/api/src/inventory/inventory-catalog.service.ts`, throws `NotFoundException` if missing),
  `OrderItem` entity (already exists at `apps/api/src/orders/entities/order-item.entity.ts`),
  `PharmacyDispensing` entity (Task 1).
- Produces: `PharmacyDispensingService.createDispensing(input: CreateDispensingInput):
  Promise<PharmacyDispensing>`, `.findOne(id: string): Promise<PharmacyDispensing>`,
  `.listByOrderItem(orderItemId: string): Promise<PharmacyDispensing[]>`, `.cancel(id: string,
  cancelReason?: string): Promise<PharmacyDispensing>` — all consumed by Task 6's controller.
  Task 5 adds `dispenseDrug` to this same service/file.

- [ ] **Step 1: Write the service (creation, read, cancel)**

`apps/api/src/pharmacy/pharmacy-dispensing.service.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Not, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { PharmacyDispensing } from './entities/pharmacy-dispensing.entity.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';

export interface CreateDispensingInput {
  orderItemId: string;
  inventoryItemId: string;
  quantity: number;
}

@Injectable()
export class PharmacyDispensingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dispensingNumberGenerator: PharmacyDispensingNumberGeneratorService,
    private readonly inventoryCatalogService: InventoryCatalogService,
  ) {}

  async createDispensing(input: CreateDispensingInput): Promise<PharmacyDispensing> {
    const quantity = Number(input.quantity);
    if (typeof input.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive number');
    }

    await this.inventoryCatalogService.getItem(input.inventoryItemId); // throws NotFoundException if missing

    const dispensingNumber = await this.dispensingNumberGenerator.generateNextDispensingNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const orderItem = await manager.getRepository(OrderItem).findOne({ where: { id: input.orderItemId } });
      if (!orderItem) {
        throw new NotFoundException(`Order item ${input.orderItemId} not found`);
      }
      if (orderItem.itemType !== 'Pharmacy') {
        throw new BadRequestException(
          `Order item ${input.orderItemId} is not a Pharmacy order (itemType: ${orderItem.itemType})`,
        );
      }
      if (orderItem.status === 'Cancelled') {
        throw new BadRequestException(`Order item ${input.orderItemId} is cancelled and cannot be dispensed`);
      }

      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const existing = await dispensingRepository.findOne({
        where: { orderItemId: input.orderItemId, status: Not('Cancelled') },
      });
      if (existing) {
        throw new ConflictException(
          `Order item ${input.orderItemId} already has a non-cancelled dispensing (${existing.id})`,
        );
      }

      try {
        return await dispensingRepository.save(
          dispensingRepository.create({
            orderItemId: input.orderItemId,
            inventoryItemId: input.inventoryItemId,
            dispensingNumber,
            quantity: String(quantity),
            status: 'Pending',
          }),
        );
      } catch (error) {
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_pharmacy_dispensings_active_order_item'
        ) {
          throw new ConflictException(`Order item ${input.orderItemId} already has a non-cancelled dispensing`);
        }
        throw error;
      }
    });
  }

  async findOne(id: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensing = await manager.getRepository(PharmacyDispensing).findOne({ where: { id } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      return dispensing;
    });
  }

  async listByOrderItem(orderItemId: string): Promise<PharmacyDispensing[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(PharmacyDispensing).find({ where: { orderItemId }, order: { createdAt: 'DESC' } }),
    );
  }

  async cancel(id: string, cancelReason?: string): Promise<PharmacyDispensing> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PharmacyDispensing);
      const dispensing = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} can only be cancelled while status is Pending (current: ${dispensing.status})`,
        );
      }

      dispensing.status = 'Cancelled';
      dispensing.cancelReason = cancelReason ?? null;
      return repository.save(dispensing);
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/pharmacy/pharmacy-dispensing.service.ts
git commit -m "feat(pharmacy): add dispensing creation, read, and cancel"
```

---

### Task 5: FEFO dispensing (stock decrement)

**Files:**
- Modify: `apps/api/src/pharmacy/pharmacy-dispensing.service.ts`

**Interfaces:**
- Consumes: `StockBatch`, `StockBalance`, `StockTransaction` entities (already exist, from
  Inventory — `apps/api/src/inventory/entities/`).
- Produces: `PharmacyDispensingService.dispenseDrug(id: string, input: DispenseDrugInput):
  Promise<PharmacyDispensing>` — consumed by Task 6's controller.

This task's FEFO walk is a direct structural copy of
`InventoryRequisitionService.fulfillRequisitionItem`'s final, already-hardened shape (found at
`apps/api/src/inventory/inventory-requisition.service.ts`, lines ~138-255) — read that method
first if anything below is unclear, since this task's code is deliberately the same pattern with
different names, not a new design.

- [ ] **Step 1: Add the imports, interface, and `dispenseDrug` method**

Add these imports to the top of `apps/api/src/pharmacy/pharmacy-dispensing.service.ts` (alongside
the existing ones from Task 4):
```ts
import { StockBatch } from '../inventory/entities/stock-batch.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { StockTransaction } from '../inventory/entities/stock-transaction.entity.js';
```

Add this interface near the top of the file, alongside `CreateDispensingInput`:
```ts
export interface DispenseDrugInput {
  dispensedBy: string;
}
```

Add this method to the `PharmacyDispensingService` class, after `cancel`:
```ts
  async dispenseDrug(id: string, input: DispenseDrugInput): Promise<PharmacyDispensing> {
    if (!input.dispensedBy?.trim()) {
      throw new BadRequestException('dispensedBy is required');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const dispensingRepository = manager.getRepository(PharmacyDispensing);
      const dispensing = await dispensingRepository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!dispensing) {
        throw new NotFoundException(`Pharmacy dispensing ${id} not found`);
      }
      if (dispensing.status !== 'Pending') {
        throw new ConflictException(
          `Dispensing ${id} must be Pending to dispense (current status: ${dispensing.status})`,
        );
      }

      const quantity = Number(dispensing.quantity);

      // FEFO: lock every StockBalance row for this item with available stock, ordered so
      // nearer-expiry batches are consumed first and no-expiry batches are consumed last.
      const balanceRows = await manager
        .createQueryBuilder(StockBalance, 'balance')
        .innerJoin(StockBatch, 'batch', 'batch.id = balance.stockBatchId')
        .where('balance.itemId = :itemId', { itemId: dispensing.inventoryItemId })
        .andWhere('balance.availableQuantity > 0')
        .orderBy('batch.expiryDate', 'ASC', 'NULLS LAST')
        .addOrderBy('batch.createdAt', 'ASC')
        .addOrderBy('balance.id', 'ASC')
        .setLock('pessimistic_write', undefined, ['balance'])
        .getMany();

      const totalAvailable = balanceRows.reduce((sum, row) => sum + Number(row.availableQuantity), 0);
      if (totalAvailable < quantity) {
        throw new BadRequestException(
          `Insufficient stock for item ${dispensing.inventoryItemId}: requested ${quantity}, available ${totalAvailable}`,
        );
      }

      let remaining = quantity;
      const transactionRepository = manager.getRepository(StockTransaction);
      for (const balanceRow of balanceRows) {
        if (remaining <= 0) break;
        const portion = Math.min(remaining, Number(balanceRow.availableQuantity));

        const updated = await manager.query<[Array<{ id: string }>, number]>(
          `
          UPDATE stock_balances
          SET "availableQuantity" = "availableQuantity" - $1, "updatedAt" = now()
          WHERE id = $2 AND "availableQuantity" >= $1
          RETURNING id
          `,
          [portion, balanceRow.id],
        );
        if (updated[1] === 0) {
          throw new Error(
            `Invariant violation: stock balance ${balanceRow.id} changed under lock during dispensing`,
          );
        }

        await transactionRepository.save(
          transactionRepository.create({
            itemId: dispensing.inventoryItemId,
            stockBatchId: balanceRow.stockBatchId,
            transactionType: 'PharmacyDispense',
            referenceId: dispensing.id,
            quantity: String(portion),
            recordedBy: input.dispensedBy,
          }),
        );

        remaining -= portion;
      }

      if (remaining > 0) {
        throw new Error(
          `Invariant violation: ${remaining} units of item ${dispensing.inventoryItemId} remained ` +
            `unfulfilled after consuming all locked stock balance rows`,
        );
      }

      dispensing.status = 'Dispensed';
      dispensing.dispensedBy = input.dispensedBy;
      dispensing.dispensedAt = new Date();
      return dispensingRepository.save(dispensing);
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/pharmacy/pharmacy-dispensing.service.ts
git commit -m "feat(pharmacy): add FEFO drug dispensing"
```

---

### Task 6: Controller, DTOs, and module wiring

**Files:**
- Create: `apps/api/src/pharmacy/pharmacy-dispensing.controller.ts`
- Create: `apps/api/src/pharmacy/dto/create-pharmacy-dispensing.dto.ts`
- Create: `apps/api/src/pharmacy/dto/dispense-drug.dto.ts`
- Create: `apps/api/src/pharmacy/dto/cancel-pharmacy-dispensing.dto.ts`
- Create: `apps/api/src/pharmacy/pharmacy.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `PharmacyDispensingService` (Tasks 4-5), `InventoryCatalogService` (already exists,
  exported by `InventoryModule`), `PharmacyDispensingNumberGeneratorService` (Task 3).

- [ ] **Step 1: Write the DTOs**

`apps/api/src/pharmacy/dto/create-pharmacy-dispensing.dto.ts`:
```ts
export class CreatePharmacyDispensingDto {
  orderItemId!: string;
  inventoryItemId!: string;
  quantity!: number;
}
```

`apps/api/src/pharmacy/dto/dispense-drug.dto.ts`:
```ts
export class DispenseDrugDto {
  dispensedBy!: string;
}
```

`apps/api/src/pharmacy/dto/cancel-pharmacy-dispensing.dto.ts`:
```ts
export class CancelPharmacyDispensingDto {
  cancelReason?: string;
}
```

- [ ] **Step 2: Write the controller**

`apps/api/src/pharmacy/pharmacy-dispensing.controller.ts`:
```ts
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { CreatePharmacyDispensingDto } from './dto/create-pharmacy-dispensing.dto.js';
import { DispenseDrugDto } from './dto/dispense-drug.dto.js';
import { CancelPharmacyDispensingDto } from './dto/cancel-pharmacy-dispensing.dto.js';

@Controller('pharmacy/dispensings')
@UseGuards(PermissionGuard)
export class PharmacyDispensingController {
  constructor(private readonly pharmacyDispensingService: PharmacyDispensingService) {}

  @Post()
  @RequirePermission('pharmacy.dispensing.create')
  async create(@Body() dto: CreatePharmacyDispensingDto) {
    return this.pharmacyDispensingService.createDispensing(dto);
  }

  @Get()
  @RequirePermission('pharmacy.read')
  async listByOrderItem(@Query('orderItemId') orderItemId: string) {
    return this.pharmacyDispensingService.listByOrderItem(orderItemId);
  }

  @Get(':id')
  @RequirePermission('pharmacy.read')
  async findOne(@Param('id') id: string) {
    return this.pharmacyDispensingService.findOne(id);
  }

  @Patch(':id/dispense')
  @RequirePermission('pharmacy.dispensing.dispense')
  async dispense(@Param('id') id: string, @Body() dto: DispenseDrugDto) {
    return this.pharmacyDispensingService.dispenseDrug(id, dto);
  }

  @Patch(':id/cancel')
  @RequirePermission('pharmacy.dispensing.create')
  async cancel(@Param('id') id: string, @Body() dto: CancelPharmacyDispensingDto) {
    return this.pharmacyDispensingService.cancel(id, dto.cancelReason);
  }
}
```

- [ ] **Step 3: Write the module**

`apps/api/src/pharmacy/pharmacy.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PharmacyDispensingService } from './pharmacy-dispensing.service.js';
import { PharmacyDispensingController } from './pharmacy-dispensing.controller.js';
import { PharmacyDispensingNumberGeneratorService } from './pharmacy-dispensing-number-generator.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [PharmacyDispensingController],
  providers: [PharmacyDispensingService, PharmacyDispensingNumberGeneratorService],
  exports: [PharmacyDispensingService],
})
export class PharmacyModule {}
```

- [ ] **Step 4: Wire the module into the app**

Modify `apps/api/src/app/app.module.ts`: add
`import { PharmacyModule } from '../pharmacy/pharmacy.module.js';` after the `InventoryModule`
import, and add `PharmacyModule` after `InventoryModule` in the `imports` array.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec nx run api:typecheck --skip-nx-cache`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pharmacy/pharmacy-dispensing.controller.ts apps/api/src/pharmacy/dto/create-pharmacy-dispensing.dto.ts apps/api/src/pharmacy/dto/dispense-drug.dto.ts apps/api/src/pharmacy/dto/cancel-pharmacy-dispensing.dto.ts apps/api/src/pharmacy/pharmacy.module.ts apps/api/src/app/app.module.ts
git commit -m "feat(pharmacy): add dispensing controller and wire pharmacy module"
```

---

### Task 7: Documentation updates

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None (documentation only).

- [ ] **Step 1: Add a Development Standards section**

Add a new `## 18. Pharmacy Dispensing Pipeline` section to
`new/docs/technical-design/Development-Standards.md`, placed after `## 17. Inventory
Requisition/Dispatch Pipeline`, covering: the order-routed reclassification pattern (mirrors Lab/
Radiology's `createRequisition` shape, including the duplicate-race prevention baked in from day
one); the decision to re-implement Item B's FEFO walk as Pharmacy's own copy rather than a shared
call, and why (different actor model, different ledger `referenceId` target, and this codebase's
established mirror-don't-extract convention); the new `'PharmacyDispense'`
`stock_transactions.transactionType` value, extending the polymorphic-`referenceId`-by-
`transactionType` convention Item B's §17 documented; the explicit scope cut (no separate drug
catalog, no verification step, no walk-in/OTC sales, Billing stays fully decoupled); and a note
that with Pharmacy's core dispensing loop shipped, any future walk-in/OTC-sales or POS/checkout
work is a distinct follow-up item, not an extension of this pipeline.

- [ ] **Step 2: Update the backlog**

In `new/docs/technical-design/pending-tasks.md`, under Phase 6's Phase 2 group, mark Pharmacy done
(mirroring the exact "done. **Not done:** ..." wording pattern the Lab/LIS, Radiology, and
Inventory bullets already use), naming as **not done**: walk-in/OTC sales (no `OrderItem`), a
separate dispensing-verification step, a pharmacy-specific drug catalog (generic name, dosage
form, strength, controlled-substance flag), POS/checkout (owned by Billing, not duplicated here),
rack/bin physical location tracking, credit billing/credit notes/supplier ledger, narcotic/
controlled-substance regulatory logging, sales returns, write-offs, and provisional IPD
consumption billing — each a distinct future item if ever needed. Remove `Pharmacy` from whatever
"not started" list currently names it alongside `Ward Supply` (check the current wording — DICOM
and Ward Supply remain unstarted, Pharmacy no longer does).

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document Pharmacy dispensing pipeline, update Phase 6 backlog status"
```
