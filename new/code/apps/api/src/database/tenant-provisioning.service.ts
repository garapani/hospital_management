import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createTenantMigrationDataSource } from './tenant-migration-data-source.js';
import { seedSystemLedgerAccounts } from '../accounting/seed-ledger-accounts.js';
import { TENANT_MIGRATIONS } from './migrations/index.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Creates a tenant's schema and role, grants the role access, runs every TENANT_MIGRATIONS
   * entry against the new schema, and grants hospital_db_user membership in the role so
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
    const adminRole = process.env['DB_USERNAME'] ?? 'hospital_db_user';

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
      // The system chart of accounts used to be seeded by migrations 0059/0085/0086; since the
      // 2026-08-27 squash moved all seed data out of migrations (Development-Standards.md §108),
      // provisioning seeds it here — same connection, same search_path, so the rows land in this
      // tenant's schema and every provisioned tenant gets them exactly as before. Already-seeded
      // schemas are a no-op (upsert keyed on the fixed ids). Skipped when the caller provisions a
      // schema with an EMPTY migration list (the migrate-tenants-backfill gate simulates a
      // "behind head" tenant that way) — with no migrations run there are no ledger_accounts yet,
      // and the runner's whole point is to backfill that schema from the real list afterwards.
      if (migrations.length > 0) {
        await seedSystemLedgerAccounts(migrationDataSource);
      }
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
      // Membership, not a login credential: lets hospital_db_user SET ROLE into this tenant.
      await grantRunner.query(`GRANT "${name}" TO "${adminRole}"`);
    } finally {
      await grantRunner.release();
    }
  }
}
