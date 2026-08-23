import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountPatientLink3000000000057 implements MigrationInterface {
  // Sort key intentionally 3xxx, not 1xxx: this ALTERs `accounts`, a table created by a legacy
  // migration (0002) whose own sort key is "2000000000001" (see 0053's comment for the full
  // explanation of why 0009-0049 use that "2xxx" scheme, and TypeORM sorting by the last 13
  // characters of `name`, not array position/filename). A "1xxx" key here would sort this
  // migration BEFORE `accounts` even exists.
  name = 'AddAccountPatientLink3000000000057';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Patient-portal accounts (accountType = 'patient') link to exactly one Patient record; staff
    // accounts leave this null. A partial unique index (rather than a plain unique constraint)
    // enforces "at most one portal account per patient" while staying silent on the staff-account
    // rows that never populate it.
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "patientId" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_accounts_patient_id_unique" ON accounts ("patientId") WHERE "patientId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_accounts_patient_id_unique"`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS "patientId"`);
  }
}
