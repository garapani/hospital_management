import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fixed Asset module (PRD Phase 3 — asset register + depreciation). Straight-line depreciation is
 * computed on read from purchaseDate/cost/usefulLifeYears, so no periodic accrual job or stored
 * accumulated value is needed yet.
 */
export class CreateFixedAssetTables0033 implements MigrationInterface {
  name = 'CreateFixedAssetTables00332000000000033';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE fixed_asset_categories (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE fixed_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "assetCode" varchar NOT NULL UNIQUE,
        "categoryId" uuid NOT NULL,
        name varchar NOT NULL,
        description text NULL,
        "purchaseDate" date NOT NULL,
        "purchaseCost" numeric(12,2) NOT NULL,
        "supplierName" varchar NULL,
        "departmentId" uuid NULL,
        condition varchar NOT NULL DEFAULT 'In Service',
        "depreciationMethod" varchar NOT NULL DEFAULT 'straight-line',
        "usefulLifeYears" numeric(5,2) NULL,
        "salvageValue" numeric(12,2) NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE fixed_asset_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE fixed_asset_sequences`);
    await queryRunner.query(`DROP TABLE fixed_assets`);
    await queryRunner.query(`DROP TABLE fixed_asset_categories`);
  }
}
