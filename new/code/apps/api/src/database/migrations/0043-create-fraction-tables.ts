import { MigrationInterface, QueryRunner } from 'typeorm';

/** Fraction & Incentive module (PRD Phase 5): doctor revenue-share rules + computed entries. */
export class CreateFractionTables0043 implements MigrationInterface {
  name = 'CreateFractionTables00432000000000043';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE fraction_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "doctorId" uuid NOT NULL,
        "departmentId" uuid NULL,
        "fractionPercent" numeric(5,2) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE fraction_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "invoiceId" uuid NOT NULL,
        "doctorId" uuid NOT NULL,
        "fractionPercent" numeric(5,2) NOT NULL,
        "baseAmount" numeric(14,2) NOT NULL,
        "shareAmount" numeric(14,2) NOT NULL,
        "recordedBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE fraction_entries`);
    await queryRunner.query(`DROP TABLE fraction_rules`);
  }
}
