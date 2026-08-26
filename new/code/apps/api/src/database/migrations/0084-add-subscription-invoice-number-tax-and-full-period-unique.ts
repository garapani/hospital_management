import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), platform-billing module:
 *  - P2: the vendor's own subscription invoices had no invoice number, tax, or GST fields —
 *    adds invoiceNumber (unique), taxPercent, taxAmount.
 *  - P3: "one invoice per period" was only enforced for OPEN invoices (partial unique index),
 *    so a re-subscribed tenant could double-bill an already-paid period — the index is widened
 *    to cover every status. */
export class AddSubscriptionInvoiceNumberTaxAndFullPeriodUnique1000000000084 implements MigrationInterface {
  name = 'AddSubscriptionInvoiceNumberTaxAndFullPeriodUnique1000000000084';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE subscription_invoices
      ADD COLUMN "invoiceNumber" varchar NULL,
      ADD COLUMN "taxPercent" numeric(5,2) NOT NULL DEFAULT 0,
      ADD COLUMN "taxAmount" numeric(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_subscription_invoices_number" ON subscription_invoices ("invoiceNumber")
    `);
    await queryRunner.query(`DROP INDEX "IDX_subscription_invoices_period"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_subscription_invoices_period"
      ON subscription_invoices ("subscriptionId", "periodStart")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_subscription_invoices_period"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_subscription_invoices_period"
      ON subscription_invoices ("subscriptionId", "periodStart") WHERE status = 'open'
    `);
    await queryRunner.query(`DROP INDEX "UQ_subscription_invoices_number"`);
    await queryRunner.query(`
      ALTER TABLE subscription_invoices
      DROP COLUMN "invoiceNumber",
      DROP COLUMN "taxPercent",
      DROP COLUMN "taxAmount"
    `);
  }
}
