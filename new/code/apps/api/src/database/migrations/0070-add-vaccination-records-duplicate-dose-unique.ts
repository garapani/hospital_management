import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P2, code-review-findings-2026-08-25.md): no duplicate-dose protection at
 *  all — no check, no unique index. `vaccine` is free text with no catalog (a separate, larger
 *  P3 gap not attempted here), so the index is on `LOWER(vaccine)` rather than the raw column —
 *  otherwise "MMR" and "mmr" would each pass a case-sensitive uniqueness check as distinct doses. */
export class AddVaccinationRecordsDuplicateDoseUnique3000000000070 implements MigrationInterface {
  name = 'AddVaccinationRecordsDuplicateDoseUnique3000000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_vaccination_records_patient_vaccine_dose"
      ON vaccination_records ("patientId", LOWER(vaccine), "doseNumber")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_vaccination_records_patient_vaccine_dose"`);
  }
}
