import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditRecordsTable implements MigrationInterface {
  name = 'CreateAuditRecordsTable';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tableName" varchar NOT NULL,
        "recordId" varchar NOT NULL,
        action varchar(20) NOT NULL,
        "changedByAccountId" varchar NULL,
        "correlationId" varchar NULL,
        diff jsonb NOT NULL,
        "occurredAt" timestamptz NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_records`);
  }
}
