import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRolePermissionsUniqueConstraint implements MigrationInterface {
  name = 'AddRolePermissionsUniqueConstraint';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE role_permissions
      ADD CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("roleId", "permissionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE role_permissions
      DROP CONSTRAINT "UQ_role_permissions_role_permission"
    `);
  }
}
