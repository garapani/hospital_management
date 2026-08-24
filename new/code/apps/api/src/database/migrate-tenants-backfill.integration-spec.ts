import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { runTenantMigrations } from './migrate-tenants.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TENANT_MIGRATIONS } from './migrations/index.js';
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
 * This spec closes that hole: it provisions a schema frozen at a fixed historical migration point
 * (everything up to and including 0049 — AddInvoiceItemChargeUnique, the last TENANT_MIGRATIONS
 * entry before 0050-0052 branch off into platform-only migrations), then runs the exact
 * `runTenantMigrations()` production code path and proves it backfills the schema to head —
 * applying both 0053 and 0057 — including that the app's real Account entity (via TypeORM, not
 * just a raw column check) can be queried afterward. If a future tenant migration silently fails
 * to apply, gets misordered (see the `migration-safety-check` skill's CreatePatientTables0008
 * incident), or the runner regresses, this test goes red.
 */
const LEGACY_CUTOFF_MIGRATION_NAME = 'AddInvoiceItemChargeUnique00492000000000049';
const cutoffIndex = TENANT_MIGRATIONS.findIndex(
  (Migration) => new Migration().name === LEGACY_CUTOFF_MIGRATION_NAME,
);
if (cutoffIndex === -1) {
  throw new Error(
    `migrate-tenants-backfill gate: cutoff migration "${LEGACY_CUTOFF_MIGRATION_NAME}" not found in TENANT_MIGRATIONS`,
  );
}
const LEGACY_MIGRATIONS = TENANT_MIGRATIONS.slice(0, cutoffIndex + 1);

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

  async function provisionLegacySchema(): Promise<void> {
    await tenantProvisioning.provisionTenantSchema(hospitalId, LEGACY_MIGRATIONS);
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

  it('reproduces the incident: a tenant stuck at migration 0049 cannot load the Account entity', async () => {
    await provisionLegacySchema();

    const columns: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'accounts' AND column_name = 'patientId'`,
      [schemaName],
    );
    expect(columns).toHaveLength(0);

    // Column ordering in the generated SELECT means the first missing column TypeORM/Postgres
    // reports may be patientId (0057) or an earlier casualty of the same gap like createdBy
    // (0053) — either way, the point this proves is that reading through the real Account entity
    // fails outright against a schema stuck behind head, exactly as AuthService.login did in prod.
    await expect(loadAccounts()).rejects.toThrow(/column .* does not exist/i);
  }, 120000);

  it('closes the gap: runTenantMigrations() backfills the tenant and the Account entity loads', async () => {
    await provisionLegacySchema();

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
