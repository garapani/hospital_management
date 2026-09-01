import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional ward assignment to staff accounts — the data half of ward-scoped row-level
 * access for the Nurse role (PRD §6.2: "Nurse can only write vitals for patients on their
 * assigned ward"; see review-comments.md, "PRD-promised ward-scoped row-level access for Nurse
 * is not implemented"). Nullable, no default: an account with no wardId keeps today's
 * tenant-wide access — ward-scoping only kicks in once a ward is explicitly assigned. Non-unique
 * index (unlike accounts.patientId's unique one) since many nurses can share a ward.
 */
export class AddAccountWard3000000000002 implements MigrationInterface {
  name = 'AddAccountWard3000000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN "wardId" uuid`);
    await queryRunner.query(
      `CREATE INDEX idx_accounts_ward_id ON accounts USING btree ("wardId") WHERE ("wardId" IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_accounts_ward_id`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN "wardId"`);
  }
}
