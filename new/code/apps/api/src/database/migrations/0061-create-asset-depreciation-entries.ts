import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fixed Asset depreciation accrual (pending-tasks.md 2.9): a persisted periodic charge per asset,
 *  alongside (not replacing) FixedAssetsService.getAssetValuation's stateless read-time calc. */
export class CreateAssetDepreciationEntriesTable3000000000061 implements MigrationInterface {
  name = 'CreateAssetDepreciationEntriesTable3000000000061';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE asset_depreciation_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "assetId" uuid NOT NULL,
        "periodMonth" int NOT NULL,
        "periodYear" int NOT NULL,
        "depreciationAmount" numeric(12,2) NOT NULL,
        "accumulatedDepreciation" numeric(12,2) NOT NULL,
        "bookValue" numeric(12,2) NOT NULL,
        "accruedBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "createdBy" varchar NULL,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        "updatedBy" varchar NULL,
        "deletedAt" timestamptz NULL,
        "deletedBy" varchar NULL,
        UNIQUE ("assetId", "periodMonth", "periodYear")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE asset_depreciation_entries`);
  }
}
