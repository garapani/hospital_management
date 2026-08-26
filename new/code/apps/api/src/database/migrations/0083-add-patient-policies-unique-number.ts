import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): no uniqueness on
 *  patient/payer/policy-number — the same policy could be entered twice for a patient, and
 *  coverage changes after claims are approved against it. The service pre-check gets a unique
 *  index backstop. */
export class AddPatientPoliciesUniqueNumber3000000000083 implements MigrationInterface {
  name = 'AddPatientPoliciesUniqueNumber3000000000083';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_patient_policies_patient_payer_number"
      ON patient_policies ("patientId", "payerId", "policyNumber")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_patient_policies_patient_payer_number"`);
  }
}
