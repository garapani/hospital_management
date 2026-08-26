import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), inventory module:
 *  - P2: `inventory_items.code` had no UNIQUE constraint — two items could silently share a
 *    code, and there was nothing to catch it (same shape as the lab_tests fix, migration 0074).
 *  - P3: no `CHECK (availableQuantity >= 0)` on `stock_balances` — nothing stopped a bug from
 *    driving a balance negative and having it look like a plausible (if wrong) quantity forever. */
export class AddInventoryItemsCodeUniqueAndStockBalanceCheck3000000000076 implements MigrationInterface {
  name = 'AddInventoryItemsCodeUniqueAndStockBalanceCheck3000000000076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventory_items ADD CONSTRAINT "UQ_inventory_items_code" UNIQUE (code)`);
    await queryRunner.query(`
      ALTER TABLE stock_balances
      ADD CONSTRAINT "CHK_stock_balances_available_quantity_non_negative" CHECK ("availableQuantity" >= 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE stock_balances DROP CONSTRAINT "CHK_stock_balances_available_quantity_non_negative"`,
    );
    await queryRunner.query(`ALTER TABLE inventory_items DROP CONSTRAINT "UQ_inventory_items_code"`);
  }
}
