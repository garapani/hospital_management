import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): audit_records had no indexes
 *  whatsoever — every audit search scanned the whole table. Adds the filter columns the
 *  AuditService actually queries (occurredAt range, tableName, recordId, changedByAccountId,
 *  correlationId). */
export class AddAuditRecordsIndexes3000000000090 implements MigrationInterface {
  name = 'AddAuditRecordsIndexes3000000000090';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_records_occurred_at" ON audit_records ("occurredAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_records_table_name" ON audit_records ("tableName")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_records_record_id" ON audit_records ("recordId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_records_changed_by" ON audit_records ("changedByAccountId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_audit_records_correlation_id" ON audit_records ("correlationId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_records_correlation_id"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_records_changed_by"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_records_record_id"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_records_table_name"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_records_occurred_at"`);
  }
}
