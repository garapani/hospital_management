import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): nothing prevented multiple
 *  maternity records per admission — createRecord() was select-then-insert only. Unlike the
 *  patients duplicate-check (where a second record is a deliberate, supported override), an
 *  admission legitimately has at most one maternity/antenatal record, so a plain (not partial)
 *  unique index is the right backstop here — mirroring UQ_discharge_summaries_admission. */
export class AddMaternityRecordsAdmissionUnique3000000000069 implements MigrationInterface {
  name = 'AddMaternityRecordsAdmissionUnique3000000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_maternity_records_admission" ON maternity_records ("admissionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_maternity_records_admission"`);
  }
}
