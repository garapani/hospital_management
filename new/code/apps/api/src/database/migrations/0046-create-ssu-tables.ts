import { MigrationInterface, QueryRunner } from 'typeorm';

/** Social Service Unit module (PRD Phase 6): charity/subsidized-care cases. */
export class CreateSsuTables0046 implements MigrationInterface {
  name = 'CreateSsuTables00462000000000046';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ssu_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "caseNumber" varchar NOT NULL UNIQUE,
        "patientId" uuid NOT NULL,
        "caseType" varchar NOT NULL,
        "eligibilityNotes" text NULL,
        "subsidyPercent" numeric(5,2) NOT NULL DEFAULT 0,
        status varchar NOT NULL DEFAULT 'Open',
        "appliedBy" uuid NOT NULL,
        "approvedBy" uuid NULL,
        "approvedAt" timestamptz NULL,
        "decisionNotes" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE ssu_sequences (
        prefix varchar NOT NULL,
        year integer NOT NULL,
        "lastSequence" integer NOT NULL,
        PRIMARY KEY (prefix, year)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ssu_sequences`);
    await queryRunner.query(`DROP TABLE ssu_cases`);
  }
}
