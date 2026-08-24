import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';
import { TENANT_MIGRATIONS } from './migrations/index.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a tenant's schema and role, grants the role access, runs every TENANT_MIGRATIONS
   * entry against the new schema, and grants identity_access membership in the role so
   * TenantConnectionService can SET ROLE into it per request. The single real production path —
   * called from TenantsService.provisionTenant() and the test helper alike.
   *
   * @param migrations Defaults to the full TENANT_MIGRATIONS list. The migrate-tenants-backfill
   * gate spec overrides this with a truncated prefix to provision a schema stuck at an older
   * migration point, then runs the real migrate-tenants runner against it to prove the gap closes.
   */
  async provisionTenantSchema(
    tenantId: string,
    migrations: typeof TENANT_MIGRATIONS = TENANT_MIGRATIONS,
  ): Promise<void> {
    if (!SAFE_TENANT_ID.test(tenantId)) {
      throw new Error(`Refusing to provision unsafe tenant id: ${tenantId}`);
    }
    // Schema name and role name are the same string for a given tenant.
    const name = `tenant_${tenantId}`;
    const adminRole = process.env['DB_USERNAME'] ?? 'identity_access';

    const setupRunner = this.dataSource.createQueryRunner();
    await setupRunner.connect();
    try {
      await setupRunner.query(`CREATE SCHEMA IF NOT EXISTS "${name}"`);
      await setupRunner.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${name}') THEN
            CREATE ROLE "${name}" NOLOGIN;
          END IF;
        END
        $$;
      `);
      await setupRunner.query(`GRANT USAGE ON SCHEMA "${name}" TO "${name}"`);
      // Covers tables/sequences created by FUTURE migrations (migrate-tenants.ts backfills) —
      // does NOT cover the tables the migration run below is about to create; those need the
      // explicit GRANT after runMigrations() completes.
      await setupRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${name}" GRANT ALL ON TABLES TO "${name}"`,
      );
      await setupRunner.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA "${name}" GRANT ALL ON SEQUENCES TO "${name}"`,
      );
    } finally {
      await setupRunner.release();
    }

    const migrationDataSource = createTenantMigrationDataSource(name, migrations);
    await migrationDataSource.initialize();
    try {
      await migrationDataSource.runMigrations({ transaction: 'each' });
    } finally {
      await migrationDataSource.destroy();
    }

    const grantRunner = this.dataSource.createQueryRunner();
    await grantRunner.connect();
    try {
      // Explicit grant for the tables/sequences the migration run above just created — default
      // privileges set earlier only apply to objects created after they were set.
      await grantRunner.query(
        `GRANT ALL ON ALL TABLES IN SCHEMA "${name}" TO "${name}"`,
      );
      await grantRunner.query(
        `GRANT ALL ON ALL SEQUENCES IN SCHEMA "${name}" TO "${name}"`,
      );
      // Membership, not a login credential: lets identity_access SET ROLE into this tenant.
      await grantRunner.query(`GRANT "${name}" TO "${adminRole}"`);
    } finally {
      await grantRunner.release();
    }
  }
}
