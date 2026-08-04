import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAdmissionsTables0014 implements MigrationInterface {
  name = 'CreateAdmissionsTables00142000000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "admissionSource" varchar NOT NULL,
        "sourceAppointmentId" uuid NULL,
        "sourceTriageEntryId" uuid NULL,
        "admittingDoctorId" uuid NOT NULL,
        "wardId" uuid NOT NULL,
        "bedId" uuid NOT NULL,
        "admissionDate" timestamptz NOT NULL DEFAULT now(),
        status varchar NOT NULL DEFAULT 'Admitted',
        "dischargeDate" timestamptz NULL,
        "dischargeType" varchar NULL,
        "dischargeCondition" varchar NULL,
        "dischargeSummary" text NULL,
        "dischargedBy" uuid NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_admissions_active_bed" ON admissions ("bedId") WHERE status = 'Admitted'
    `);
    await queryRunner.query(`
      CREATE TABLE bed_transfers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "fromBedId" uuid NULL,
        "toBedId" uuid NOT NULL,
        "transferredAt" timestamptz NOT NULL DEFAULT now(),
        "transferredBy" uuid NOT NULL,
        reason text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE bed_transfers`);
    await queryRunner.query(`DROP TABLE admissions`);
  }
}
