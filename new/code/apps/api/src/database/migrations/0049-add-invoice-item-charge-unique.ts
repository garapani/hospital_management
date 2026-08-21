import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One charge per completed order item, enforced at the database. The charge-capture subscriber's
 * `already-charged` check is a plain SELECT, so two concurrent captures of the same order item
 * could both pass it and insert duplicate lines; a unique partial index (NULLs — manually-created
 * invoice lines without a source order item — are exempt) turns the second insert into a hard
 * constraint violation. Combined with the per-patient advisory lock taken inside
 * `captureChargeForOrderItem` (migration 0049's sibling change), the completing workflow is
 * race-free.
 */
export class AddInvoiceItemChargeUnique0049 implements MigrationInterface {
  // Tenant migrations use the 20000000000NN timestamp namespace (platform uses 10000000000NN) —
  // TypeORM sorts pending migrations by parseInt(name.slice(-13)), so a 100… name would run
  // BEFORE the billing-tables migration and resolve `invoice_items` to the legacy public table.
  name = 'AddInvoiceItemChargeUnique00492000000000049';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_invoice_items_source_order_item"
        ON invoice_items ("sourceOrderItemId")
        WHERE "sourceOrderItemId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_invoice_items_source_order_item"`);
  }
}
