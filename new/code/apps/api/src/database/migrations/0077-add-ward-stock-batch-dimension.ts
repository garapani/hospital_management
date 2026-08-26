import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), ward-supply module:
 *  - P2: ward stock had no batch or expiry dimension — a receive/consume ledger row couldn't say
 *    *which* batch of an item moved, so stock was untraceable once it left the central store.
 *    Adds a per-(department, item, batch) balance table mirroring the central store's
 *    stock_batches/stock_balances shape, plus provenance columns on the ledger.
 *  - P3 (batch): Return/Adjust/Wastage ledger types share the same table (varchar column, no
 *    migration needed for the values themselves); the balance/ledger consistency rules live in
 *    the service. */
export class AddWardStockBatchDimension3000000000077 implements MigrationInterface {
  name = 'AddWardStockBatchDimension3000000000077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ward_stock_batches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "departmentId" uuid NOT NULL,
        "itemId" uuid NOT NULL,
        "batchNumber" varchar NOT NULL DEFAULT '',
        "expiryDate" date NULL,
        quantity numeric(12,2) NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ward_stock_batches_department_item_batch"
      ON ward_stock_batches ("departmentId", "itemId", "batchNumber")
    `);
    await queryRunner.query(`
      ALTER TABLE ward_stock_batches
      ADD CONSTRAINT "CHK_ward_stock_batches_quantity_non_negative" CHECK (quantity >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE ward_stock_transactions
      ADD COLUMN "batchNumber" varchar NULL,
      ADD COLUMN "expiryDate" date NULL
    `);
    // Backfill: every pre-existing balance row is treated as a single unbatched lot ('' sentinel),
    // keeping the aggregate balance == sum of batch quantities invariant true from day one.
    await queryRunner.query(`
      INSERT INTO ward_stock_batches ("departmentId", "itemId", "batchNumber", "expiryDate", "quantity")
      SELECT "departmentId", "itemId", '', NULL, "availableQuantity" FROM ward_stock_balances
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ward_stock_batches`);
    await queryRunner.query(`
      ALTER TABLE ward_stock_transactions
      DROP COLUMN "batchNumber",
      DROP COLUMN "expiryDate"
    `);
  }
}
