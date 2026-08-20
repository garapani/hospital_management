import { MigrationInterface, QueryRunner } from 'typeorm';

/** CSSD module (PRD Phase 4): sterile supply tracking — instrument catalog + sterilization cycles. */
export class CreateCssdTables0040 implements MigrationInterface {
  name = 'CreateCssdTables00402000000000040';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cssd_instruments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar NOT NULL,
        name varchar NOT NULL,
        category varchar NULL,
        quantity int NOT NULL DEFAULT 0,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE cssd_sterilization_cycles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "instrumentId" uuid NOT NULL,
        method varchar NOT NULL,
        "startedAt" timestamptz NULL,
        "completedAt" timestamptz NULL,
        status varchar NOT NULL DEFAULT 'InProgress',
        "sterileExpiryAt" timestamptz NULL,
        "operatedBy" uuid NOT NULL,
        "failureReason" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE cssd_sterilization_cycles`);
    await queryRunner.query(`DROP TABLE cssd_instruments`);
  }
}
