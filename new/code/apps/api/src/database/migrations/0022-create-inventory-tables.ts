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
