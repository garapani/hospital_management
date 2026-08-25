import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P1, code-review-findings-2026-08-25.md): admit() only checked bed
 *  availability, never whether the patient already had an active admission elsewhere — a patient
 *  could be admitted into two different free beds at once. Backs the application-level check with
 *  a DB constraint, matching the existing UQ_admissions_active_bed pattern. */
export class AddAdmissionsActivePatientUnique3000000000062 implements MigrationInterface {
  name = 'AddAdmissionsActivePatientUnique3000000000062';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_admissions_active_patient" ON admissions ("patientId") WHERE status = 'Admitted'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_admissions_active_patient"`);
  }
}
