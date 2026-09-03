import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OTC/walk-in pharmacy dispensing: pending-tasks.md Phase 6 Pharmacy item's "Not done" gap —
 * `createDispensing` requires an existing `OrderItem`, so a patient without a doctor's order has
 * no code path. `orderItemId` becomes nullable to allow a dispensing with no order behind it
 * (`PharmacyDispensingService.createWalkInSale`); `patientId` is populated only on that path (an
 * order-routed dispensing derives its patient via `orders.patientId`, so it stays null there —
 * same "populated on one path only" idiom `invoice_items.sourceOrderItemId` already uses).
 * `UQ_pharmacy_dispensings_active_order_item`'s partial unique index on `orderItemId` needs no
 * change: Postgres treats NULLs as distinct, so multiple walk-in rows never collide with it.
 */
export class AddPharmacyWalkInSale3000000000007 implements MigrationInterface {
  name = 'AddPharmacyWalkInSale3000000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ALTER COLUMN "orderItemId" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN "patientId" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN "patientId"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ALTER COLUMN "orderItemId" SET NOT NULL`);
  }
}
