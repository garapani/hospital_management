import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a free-text allergies column to the tenant-scoped patients table — nullable, so it
 * backfills cleanly against every already-provisioned tenant with no default/backfill step
 * needed (see review-comments.md, "No allergy field exists anywhere in the system").
 */
export class AddPatientAllergies3000000000001 implements MigrationInterface {
  name = 'AddPatientAllergies3000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN allergies text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN allergies`);
  }
}
