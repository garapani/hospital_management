import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OT (Operation Theatre) module (PRD Phase 4): surgery scheduling + execution status.
 */
export class CreateOtTables0038 implements MigrationInterface {
  name = 'CreateOtTables00382000000000038';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ot_surgeries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "surgeryNumber" varchar NOT NULL UNIQUE,
        "patientId" uuid NOT NULL,
        "admissionId" uuid NULL,
        "procedureName" varchar NOT NULL,
        "otRoom" varchar NULL,
        "scheduledAt" timestamptz NULL,
        "surgeonId" uuid NULL,
        "anesthesiologistId" uuid NULL,
        status varchar NOT NULL DEFAULT 'Scheduled',
        "startedAt" timestamptz NULL,
        "endedAt" timestamptz NULL,
        notes text NULL,
        "scheduledBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ot_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ot_sequences`);
    await queryRunner.query(`DROP TABLE ot_surgeries`);
  }
}
