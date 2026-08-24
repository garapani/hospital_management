import { DataSource } from 'typeorm';
import { ObjectStorageService } from '@hospital/object-storage';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { runTenantMigrations } from './migrate-tenants.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { AccountsService } from '../accounts/accounts.service.js';

describe('runTenantMigrations (integration)', () => {
  let dataSource: DataSource;
  let tenantsService: TenantsService;
  const hospitalId = 'test_migrate_tenants_purge';
  const schemaName = `tenant_${hospitalId}`;

  async function cleanup(): Promise<void> {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [hospitalId]);
  }

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    tenantsService = new TenantsService(
      dataSource,
      new TenantProvisioningService(dataSource),
      tenantConnection,
      tenantContext,
      new PackagesService(dataSource),
      new AccountsService(tenantConnection, dataSource, tenantContext),
      new ObjectStorageService(),
    );
    await cleanup();
  }, 120000);

  afterAll(async () => {
    await cleanup();
    await dataSource.destroy();
  }, 120000);

  it('skips a purged tombstone (dropped schema) instead of falling through to public', async () => {
    await tenantsService.provisionTenant({
      hospitalId,
      hospitalName: 'Migrate Tenants Purge Test',
      adminUsername: `admin.${hospitalId}`,
      adminEmail: `admin.${hospitalId}@example.com`,
      adminPassword: 'a-purge-runner-password',
    });
    await tenantsService.archiveTenant(hospitalId);
    await tenantsService.purgeTenant(hospitalId, hospitalId);

    // Confirm the fixture is what the bug depends on: registry row present, schema gone.
    const tenantRow = await dataSource.query(`SELECT status FROM tenants WHERE "hospitalId" = $1`, [
      hospitalId,
    ]);
    expect(tenantRow[0].status).toBe('purged');
    const schemaRow = await dataSource.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [schemaName],
    );
    expect(schemaRow).toHaveLength(0);

    const publicTablesBefore: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );

    const result = await runTenantMigrations();

    expect(result.tenantsSkipped).toContain(hospitalId);

    const publicTablesAfter: { table_name: string }[] = await dataSource.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(publicTablesAfter).toEqual(publicTablesBefore);
  }, 120000);

  it('is idempotent: running twice against a registry containing a purged tombstone succeeds both times', async () => {
    await expect(runTenantMigrations()).resolves.toBeDefined();
    const second = await runTenantMigrations();
    expect(second.tenantsSkipped).toContain(hospitalId);
  }, 120000);
});
