import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantAccountTables1738200000001 implements MigrationInterface {
  name = 'CreateTenantAccountTables1738200000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountType" varchar(20) NOT NULL,
        "displayName" varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "needsPasswordUpdate" boolean NOT NULL DEFAULT false,
        "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        "lockedUntil" timestamptz NULL,
        username varchar UNIQUE NULL,
        email varchar NULL,
        "passwordHash" varchar NULL,
        "phoneNumber" varchar NULL,
        "phoneVerifiedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE TABLE account_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "accountId" uuid NOT NULL REFERENCES accounts(id),
        "roleId" uuid NOT NULL,
        "startDate" timestamptz NULL,
        "endDate" timestamptz NULL,
        "isActive" boolean NOT NULL DEFAULT true
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE account_roles`);
    await queryRunner.query(`DROP TABLE accounts`);
  }
}
