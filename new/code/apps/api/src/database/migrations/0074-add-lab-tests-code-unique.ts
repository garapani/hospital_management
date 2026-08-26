import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): `lab_tests.code` had no UNIQUE
 *  constraint — two tests could silently share a code, and there was nothing to catch it. */
export class AddLabTestsCodeUnique3000000000074 implements MigrationInterface {
  name = 'AddLabTestsCodeUnique3000000000074';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE lab_tests ADD CONSTRAINT "UQ_lab_tests_code" UNIQUE (code)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE lab_tests DROP CONSTRAINT "UQ_lab_tests_code"`);
  }
}
