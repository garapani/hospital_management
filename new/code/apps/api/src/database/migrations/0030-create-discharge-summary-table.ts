import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The DischargeSummary entity existed (apps/api/src/admissions/entities/
 * discharge-summary.entity.ts) and its routes were wired, but the entity was never registered in
 * data-source.ts's entities list and no migration created the discharge_summaries table — every
 * call to the discharge-summary endpoints threw EntityMetadataNotFoundError. Found during the
 * 2026-08-20 actor-derivation pass (see Development-Standards.md §25).
 */
export class CreateDischargeSummaryTable0030 implements MigrationInterface {
  name = 'CreateDischargeSummaryTable00302000000000030';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE discharge_summaries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "patientId" uuid NOT NULL,
        "primaryDiagnosis" text NULL,
        "secondaryDiagnoses" text[] NOT NULL DEFAULT '{}',
        "proceduresPerformed" text[] NOT NULL DEFAULT '{}',
        "hospitalCourse" text NULL,
        "dischargeMedications" text NULL,
        "followUpInstructions" text NULL,
        "warningSigns" text NULL,
        "activityRestrictions" text NULL,
        "followUpAppointmentDate" timestamptz NULL,
        "followUpDoctorId" uuid NULL,
        "dietRecommendations" text NULL,
        "additionalNotes" text NULL,
        "preparedBy" uuid NOT NULL,
        "reviewedBy" uuid NULL,
        "reviewedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE discharge_summaries`);
  }
}
