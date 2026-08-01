import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReportingTables0017 implements MigrationInterface {
  name = 'CreateReportingTables0017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reporting_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "eventType" character varying NOT NULL,
        "entityId" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "correlationId" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reporting_events" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reporting_events"`);
  }
}
