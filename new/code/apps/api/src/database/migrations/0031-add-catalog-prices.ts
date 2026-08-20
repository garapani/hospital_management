import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds selling prices to the three clinical/inventory catalogs so Billing's automatic
 * charge-capture (see billing/charge-capture.subscriber.ts) can price a completed order item.
 * Single currency (INR), nullable = "not priced yet" (charge-capture skips those items).
 */
export class AddCatalogPrices0031 implements MigrationInterface {
  name = 'AddCatalogPrices00312000000000031';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lab_tests ADD COLUMN price numeric(10,2) NULL`);
    await queryRunner.query(
      `ALTER TABLE radiology_imaging_items ADD COLUMN price numeric(10,2) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE inventory_items ADD COLUMN "salePrice" numeric(10,2) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE inventory_items DROP COLUMN "salePrice"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items DROP COLUMN price`);
    await queryRunner.query(`ALTER TABLE lab_tests DROP COLUMN price`);
  }
}
