import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReportingTables0017 implements MigrationInterface {
  name = 'CreateReportingTables0017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reporting_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "eventType" character varying NOT NULL,
        "entityId" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "correlationId" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reporting_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reporting_events_type_occurred_at" ON "reporting_events" ("eventType", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_reporting_events_entity_id" ON "reporting_events" ("entityId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_reporting_events_entity_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_reporting_events_type_occurred_at"`,
    );
    await queryRunner.query(`DROP TABLE "reporting_events"`);
  }
}
