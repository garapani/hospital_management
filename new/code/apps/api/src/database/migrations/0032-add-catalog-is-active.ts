import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Soft-delete flags for the clinical/inventory catalogs: deactivated entries stay visible to
 * existing records (requisitions keep their testId/itemId references intact) but are rejected for
 * new use. Mirrors the master-data department/ward/bed isActive pattern.
 */
export class AddCatalogIsActive0032 implements MigrationInterface {
  name = 'AddCatalogIsActive00322000000000032';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'lab_tests',
      'lab_test_categories',
      'radiology_imaging_items',
      'radiology_imaging_types',
      'inventory_items',
      'inventory_item_categories',
      'inventory_item_sub_categories',
      'inventory_vendors',
    ]) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN "isActive" boolean NOT NULL DEFAULT true`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'inventory_vendors',
      'inventory_item_sub_categories',
      'inventory_item_categories',
      'inventory_items',
      'radiology_imaging_types',
      'radiology_imaging_items',
      'lab_test_categories',
      'lab_tests',
    ]) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN "isActive"`);
    }
  }
}
