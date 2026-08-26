import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), pharmacy module:
 *  - P2: no reversal path once stock is dispensed — added reversedBy/reversedAt/reversalReason so
 *    PharmacyDispensingService.reverseDispensing() can record the actor/reason for crediting stock
 *    back after a Dispensed record. Nullable — only ever set on the reversal transition.
 *  - Once reversed, a new dispensing must be creatable against the same order item, so the
 *    0024 partial unique index (`WHERE status <> 'Cancelled'`) — which would still treat a
 *    Reversed row as "active" and block the insert — is replaced with one that also excludes
 *    Reversed, matching PharmacyDispensingService.createDispensing()'s widened in-app guard. */
export class AddPharmacyDispensingsReversalColumns3000000000075 implements MigrationInterface {
  name = 'AddPharmacyDispensingsReversalColumns3000000000075';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "reversedBy" uuid`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "reversedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "reversalReason" text`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_pharmacy_dispensings_active_order_item"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pharmacy_dispensings_active_order_item"
      ON pharmacy_dispensings ("orderItemId")
      WHERE status IN ('Pending', 'Dispensed')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_pharmacy_dispensings_active_order_item"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_pharmacy_dispensings_active_order_item"
      ON pharmacy_dispensings ("orderItemId")
      WHERE status <> 'Cancelled'
    `);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "reversalReason"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "reversedAt"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "reversedBy"`);
  }
}
