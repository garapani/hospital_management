import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds free-text insurance-provider/policy-number columns to the tenant-scoped patients table —
 * nullable, backfills cleanly against every already-provisioned tenant. Deliberately free text,
 * not a foreign key into insurance_payers: this is captured by Receptionist at intake
 * (PRD's "Receptionist / Front Desk" scope is Patient/Appointment/Billing charge-capture, not
 * Insurance & Claims — that's Billing/Accounts Staff's scope), so it's a quick note for the
 * front desk to pass along, not a formal policy — Billing/Accounts Staff still sets up the real
 * PatientPolicy (payer, coverage window, sum insured) via the Insurance module. See
 * review-comments.md, "No insurance/payer capture at patient registration intake".
 */
export class AddPatientInsuranceInfo3000000000003 implements MigrationInterface {
  name = 'AddPatientInsuranceInfo3000000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN "insuranceProvider" varchar(150)`);
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN "insurancePolicyNumber" varchar(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN "insurancePolicyNumber"`);
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN "insuranceProvider"`);
  }
}
