import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): createDischargeSummary()'s
 *  "already exists" check was select-then-insert with no backing constraint, so two concurrent
 *  calls for the same admission could both pass the check and insert duplicate summaries. Backs
 *  the application-level check with a DB constraint, matching the UQ_admissions_active_bed /
 *  UQ_admissions_active_patient / UQ_fraction_entries_invoice_doctor pattern. */
export class AddDischargeSummariesAdmissionUnique3000000000065 implements MigrationInterface {
  name = 'AddDischargeSummariesAdmissionUnique3000000000065';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_discharge_summaries_admission" ON discharge_summaries ("admissionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_discharge_summaries_admission"`);
  }
}
