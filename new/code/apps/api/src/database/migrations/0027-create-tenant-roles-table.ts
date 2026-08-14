import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `tenant_roles` join table that `Tenant.roles` (@JoinTable in tenant.entity.ts),
 * `TenantsService.provisionTenant()` and `AccountsService.listRoles()` have all been referencing
 * without it ever existing — `listRoles()` therefore failed with a Postgres "relation does not
 * exist" error, which surfaced as a 500 on GET /accounts/roles and made staff-account creation
 * impossible in both consoles.
 *
 * The backfill is not optional. `listRoles()` inner-joins this table whenever a tenant is in
 * context, so an empty table would turn the 500 into a silently empty role list — the same broken
 * behaviour, just harder to notice. Every pre-existing tenant is therefore granted the whole
 * catalog, preserving the effective behaviour the code assumed all along.
 */
export class CreateTenantRolesTable0027 implements MigrationInterface {
  name = 'CreateTenantRolesTable1000000000027';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_roles (
        "tenantId" varchar NOT NULL REFERENCES tenants("hospitalId") ON DELETE CASCADE,
        "roleId" uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        CONSTRAINT "PK_tenant_roles" PRIMARY KEY ("tenantId", "roleId")
      )
    `);

    // Lookups are always "which roles does this tenant have", so the PK's leading column already
    // serves them. The reverse ("which tenants use this role") needs its own index.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tenant_roles_roleId" ON tenant_roles ("roleId")`,
    );

    await queryRunner.query(`
      INSERT INTO tenant_roles ("tenantId", "roleId")
      SELECT t."hospitalId", r.id FROM tenants t CROSS JOIN roles r
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenant_roles_roleId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_roles`);
  }
}
