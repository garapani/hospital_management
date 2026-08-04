import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEncounterTables011 implements MigrationInterface {
  name = 'CreateEncounterTables0112000000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE clinical_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "appointmentId" uuid NULL,
        "doctorId" uuid NOT NULL,
        "chiefComplaint" text NULL,
        "historyOfPresentingIllness" text NULL,
        "physicalExamination" text NULL,
        "plan" text NULL,
        "status" varchar(50) NOT NULL DEFAULT 'Draft',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE diagnoses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "appointmentId" uuid NULL,
        "doctorId" uuid NOT NULL,
        "icd10Code" varchar(50) NULL,
        "description" varchar(500) NOT NULL,
        "isPrimary" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE prescriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "patientId" uuid NOT NULL,
        "appointmentId" uuid NULL,
        "doctorId" uuid NOT NULL,
        "medicationName" varchar(255) NOT NULL,
        "dosage" varchar(100) NOT NULL,
        "frequency" varchar(100) NOT NULL,
        "route" varchar(100) NOT NULL,
        "durationDays" int NOT NULL,
        "notes" text NULL,
        "status" varchar(50) NOT NULL DEFAULT 'Active',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE prescriptions`);
    await queryRunner.query(`DROP TABLE diagnoses`);
    await queryRunner.query(`DROP TABLE clinical_notes`);
  }
}
