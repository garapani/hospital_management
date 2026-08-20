import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nursing module (PRD Phase 4): nursing tasks + medication administration records (MAR).
 */
export class CreateNursingTables0037 implements MigrationInterface {
  name = 'CreateNursingTables00372000000000037';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE nursing_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "taskType" varchar NOT NULL,
        description text NOT NULL,
        "dueAt" timestamptz NULL,
        status varchar NOT NULL DEFAULT 'Pending',
        "assignedTo" uuid NULL,
        "completedBy" uuid NULL,
        "completedAt" timestamptz NULL,
        "createdBy" uuid NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE medication_administrations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "admissionId" uuid NOT NULL,
        "drugName" varchar NOT NULL,
        dose varchar NOT NULL,
        route varchar NULL,
        "scheduledAt" timestamptz NULL,
        status varchar NOT NULL DEFAULT 'Scheduled',
        "administeredBy" uuid NULL,
        "administeredAt" timestamptz NULL,
        notes text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE medication_administrations`);
    await queryRunner.query(`DROP TABLE nursing_tasks`);
  }
}
