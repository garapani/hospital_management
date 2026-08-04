import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountRolesUniqueActiveAssignment implements MigrationInterface {
  name = 'AddAccountRolesUniqueActiveAssignment2000000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_account_roles_active_assignment"
      ON account_roles ("accountId", "roleId")
      WHERE "isActive" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_account_roles_active_assignment"`);
  }
}
