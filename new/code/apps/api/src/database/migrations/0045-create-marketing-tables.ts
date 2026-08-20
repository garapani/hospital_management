import { MigrationInterface, QueryRunner } from 'typeorm';

/** Marketing & Referral module (PRD Phase 6): referral-source catalog + patient referral records. */
export class CreateMarketingTables0045 implements MigrationInterface {
  name = 'CreateMarketingTables00452000000000045';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE referral_sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        "sourceType" varchar NOT NULL DEFAULT 'Other',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE patient_referrals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "sourceId" uuid NOT NULL,
        "referredByDoctorId" uuid NULL,
        "referredAt" timestamptz NOT NULL DEFAULT now(),
        notes text NULL,
        "recordedBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE patient_referrals`);
    await queryRunner.query(`DROP TABLE referral_sources`);
  }
}
