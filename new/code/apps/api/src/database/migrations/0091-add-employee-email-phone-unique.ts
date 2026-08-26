import { MigrationInterface, QueryRunner } from 'typeorm';

/** Code review finding (P3, code-review-findings-2026-08-25.md): no unique constraint on
 *  employee email or phone — duplicates silently accumulate. Partial indexes (WHERE ... IS NOT
 *  NULL) so the nullable columns still allow multiple NULLs. */
export class AddEmployeeEmailPhoneUnique3000000000091 implements MigrationInterface {
  name = 'AddEmployeeEmailPhoneUnique3000000000091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_employees_email" ON employees (email) WHERE email IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_employees_phone" ON employees (phone) WHERE phone IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_employees_phone"`);
    await queryRunner.query(`DROP INDEX "UQ_employees_email"`);
  }
}
