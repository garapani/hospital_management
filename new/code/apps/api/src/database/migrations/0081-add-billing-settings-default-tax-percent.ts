import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): charge capture hardcoded 0% tax
 *  on every auto-captured line — there was no tax source to consult. A hospital-level default
 *  GST rate on billing_settings is the seam; captured lines use it (0 = exempt/unchanged). */
export class AddBillingSettingsDefaultTaxPercent3000000000081 implements MigrationInterface {
  name = 'AddBillingSettingsDefaultTaxPercent3000000000081';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE billing_settings
      ADD COLUMN "defaultTaxPercent" numeric(5,2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE billing_settings DROP COLUMN "defaultTaxPercent"`);
  }
}
