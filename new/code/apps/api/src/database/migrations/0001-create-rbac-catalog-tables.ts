import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRbacCatalogTables implements MigrationInterface {
  name = 'CreateRbacCatalogTables1000000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL,
        priority integer NOT NULL DEFAULT 0,
        "bypassesPermissionChecks" boolean NOT NULL DEFAULT false,
        "isCrossTenant" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(`
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL UNIQUE,
        description varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
    await queryRunner.query(`
      CREATE TABLE role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "roleId" uuid NOT NULL REFERENCES roles(id),
        "permissionId" uuid NOT NULL REFERENCES permissions(id)
      )
    `);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE role_permissions`);
    await queryRunner.query(`DROP TABLE permissions`);
    await queryRunner.query(`DROP TABLE roles`);
  }
}
