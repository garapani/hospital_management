import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): referral sources had no
 *  uniqueness at any layer — two sources could silently share a name. Same shape as the
 *  lab_tests code-uniqueness fix (migration 0074). */
export class AddReferralSourcesNameUnique3000000000089 implements MigrationInterface {
  name = 'AddReferralSourcesNameUnique3000000000089';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE referral_sources ADD CONSTRAINT "UQ_referral_sources_name" UNIQUE (name)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE referral_sources DROP CONSTRAINT "UQ_referral_sources_name"`);
  }
}
