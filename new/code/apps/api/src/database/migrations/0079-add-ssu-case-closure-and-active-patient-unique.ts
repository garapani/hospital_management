import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review findings (code-review-findings-2026-08-25.md), ssu module:
 *  - P3: `closeCase` recorded no closure actor/timestamp — the closure is a decision like any
 *    other and deserves the same audit shape as approvedBy/approvedAt. varchar for the actor
 *    column, matching the audit-columns rationale (test tokens sign non-uuid sub values, §73).
 *  - P3: nothing limited Open cases per patient — the service pre-check gets a partial unique
 *    index backstop, mirroring the admissions/maternity/ot patterns. */
export class AddSsuCaseClosureAndActivePatientUnique3000000000079 implements MigrationInterface {
  name = 'AddSsuCaseClosureAndActivePatientUnique3000000000079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ssu_cases
      ADD COLUMN "closedBy" varchar NULL,
      ADD COLUMN "closedAt" timestamptz NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_ssu_cases_active_patient"
      ON ssu_cases ("patientId")
      WHERE status = 'Open'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_ssu_cases_active_patient"`);
    await queryRunner.query(`
      ALTER TABLE ssu_cases
      DROP COLUMN "closedBy",
      DROP COLUMN "closedAt"
    `);
  }
}
