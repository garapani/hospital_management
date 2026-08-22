import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantBranding1000000000052 implements MigrationInterface {
  name = 'CreateTenantBranding1000000000052';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_branding (
        "tenantId" varchar PRIMARY KEY REFERENCES tenants("hospitalId") ON DELETE CASCADE,
        "displayName" varchar,
        "primaryColor" varchar(7),
        "logoObjectKey" varchar,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_branding`);
  }
}
