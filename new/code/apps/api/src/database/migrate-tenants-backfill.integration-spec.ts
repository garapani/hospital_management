import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { runTenantMigrations } from './migrate-tenants.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { seedPackagesCatalog } from '../packages/seed-packages-catalog.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { Account } from '../accounts/entities/account.entity.js';

/**
 * Verification gate for the 2026-08-23 incident: migration 0057 (AddAccountPatientLink) shipped
 * and was registered in TENANT_MIGRATIONS, but `api:migrate-tenants` was never re-run against
 * already-provisioned tenant schemas, so `accounts.patientId` was missing everywhere and every
 * login failed with "column Account.patientId does not exist" (folded into a generic 401 by
 * AuthService.login's anti-enumeration catch). The existing integration suite never caught this
 * because every test provisions a *fresh* schema against the *current* TENANT_MIGRATIONS list —
 * there was no test simulating a tenant that predates a migration.
 *
 * This spec closes that hole: it provisions a schema behind head, then runs the exact
 * `runTenantMigrations()` production code path and proves it backfills the schema to head —
 * including that the app's real Account entity (via TypeORM, not just a raw column check) can be
 * queried afterward. If a future tenant migration silently fails to apply, gets misordered, or
 * the runner regresses, this test goes red.
 *
 * Post-squash adaptation (2026-08-27, Development-Standards.md §108): the migration history
 * (0001-0092) was squashed into a single immutable tenant baseline, so there is no historical
 * migration point left to freeze a schema at — the canonical "behind head" state is now a schema
 * provisioned with an EMPTY migration list (bare schema, no tenant tables). The runner must still
 * discover the whole baseline as pending and apply it, and the Account entity must load after.
 */
describe('runTenantMigrations backfill gate (integration)', () => {
  let dataSource: DataSource;
  let tenantProvisioning: TenantProvisioningService;
  let tenantContext: TenantContextService;
  let tenantConnection: TenantConnectionService;
  const hospitalId = 'test_migrate_tenants_backfill_gate';
  const schemaName = `tenant_${hospitalId}`;

  async function cleanup(): Promise<void> {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [hospitalId]);
  }

  async function provisionBareSchema(): Promise<void> {
    // A schema with NO tenant migrations applied — the post-squash "stuck behind head" state.
    await tenantProvisioning.provisionTenantSchema(hospitalId, []);
    await dataSource.getRepository(Tenant).save({
      hospitalId,
      hospitalName: 'Migrate Tenants Backfill Gate Test',
      status: 'active',
    });
  }

  function loadAccounts(): Promise<Account[]> {
    return tenantContext.run({ tenantId: hospitalId, correlationId: 'migrate-tenants-backfill-gate' }, () =>
      tenantConnection.runInTenantSchema((manager) => manager.getRepository(Account).find()),
    );
  }

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    // The Tenant row saved by provisionBareSchema() carries the default packageCode 'basic',
    // whose FK requires the packages catalog rows (seeded by script since the 2026-08-27 squash,
    // Development-Standards.md §108) — not provided by the harness here (this spec provisions
    // directly), so seed them explicitly.
    await seedPackagesCatalog(dataSource);
    tenantProvisioning = new TenantProvisioningService(dataSource);
    tenantContext = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    await cleanup();
  }, 120000);

  afterEach(async () => {
    await cleanup();
  }, 120000);

  afterAll(async () => {
    await dataSource.destroy();
  }, 120000);

  it('reproduces the incident: a bare schema (behind head) cannot load the Account entity', async () => {
    await provisionBareSchema();

    const columns: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'accounts' AND column_name = 'patientId'`,
      [schemaName],
    );
    expect(columns).toHaveLength(0);

    // Reading through the real Account entity fails outright against a schema with no tenant
    // migrations, exactly as AuthService.login did in prod.
    await expect(loadAccounts()).rejects.toThrow(/does not exist/i);
  }, 120000);

  it('closes the gap: runTenantMigrations() backfills the tenant and the Account entity loads', async () => {
    await provisionBareSchema();

    const result = await runTenantMigrations();
    expect(result.tenantsSkipped).not.toContain(hospitalId);

    const columns: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'accounts' AND column_name = 'patientId'`,
      [schemaName],
    );
    expect(columns).toHaveLength(1);

    await expect(loadAccounts()).resolves.toEqual([]);
  }, 120000);
});
