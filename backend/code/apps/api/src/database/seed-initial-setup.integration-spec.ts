import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { seedPlatformAdmin, seedDemoHospitalAdmin } from './seed-initial-setup.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// These specs run against the SAME database as local dev. Both seeded tenants are therefore
// redirected to test_-scoped ids via env overrides, and teardown drops only those — the real
// __platform schema and its Super Admin must survive a test run untouched.
const TEST_PLATFORM_TENANT = 'test_seed_split_platform';
const TEST_DEMO_TENANT = 'test_seed_split_demo';

describe('seed-initial-setup (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'seed_split', seedRbac: true });
    process.env['PLATFORM_ADMIN_TENANT_ID'] = TEST_PLATFORM_TENANT;
    process.env['MASTER_ADMIN_TENANT_ID'] = TEST_DEMO_TENANT;
    await seedPlatformAdmin(ctx.dataSource);
    await seedDemoHospitalAdmin(ctx.dataSource);
  });

  afterAll(async () => {
    delete process.env['PLATFORM_ADMIN_TENANT_ID'];
    delete process.env['MASTER_ADMIN_TENANT_ID'];
    for (const id of [TEST_PLATFORM_TENANT, TEST_DEMO_TENANT]) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${id}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "tenant_${id}"`);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" IN ($1, $2)`, [
      TEST_PLATFORM_TENANT,
      TEST_DEMO_TENANT,
    ]);
    await teardownTenantTestContext(ctx);
  });

  function accountsIn(tenantId: string) {
    const tenantContext = new TenantContextService();
    const accountsService = new AccountsService(
      new TenantConnectionService(ctx.dataSource, tenantContext),
      ctx.dataSource,
      tenantContext,
    );
    return {
      find: (username: string) =>
        tenantContext.run({ tenantId, correlationId: 'seed-split-spec' }, () =>
          accountsService.findByUsernameWithRoles(username),
        ),
    };
  }

  it('creates the superadmin account inside the platform tenant with the Super Admin role', async () => {
    const account = await accountsIn(TEST_PLATFORM_TENANT).find('superadmin');

    expect(account).not.toBeNull();
    expect(account?.roleNames).toContain('Super Admin');
  });

  it('does not create a Super Admin inside the demo hospital tenant', async () => {
    const account = await accountsIn(TEST_DEMO_TENANT).find('superadmin');

    expect(account).toBeNull();
  });

  it('creates the demo hospital administrator with the Hospital Admin role', async () => {
    const account = await accountsIn(TEST_DEMO_TENANT).find('demoadmin');

    expect(account).not.toBeNull();
    expect(account?.roleNames).toContain('Hospital Admin');
  });

  // The platform/tenant data boundary is structural: scope comes from the JWT's tenant, so a
  // hospital user's queries never reach the platform schema. Asserted here against the new tenant
  // because this is the seam the whole design leans on.
  it('does not expose the platform admin account to a hospital tenant lookup', async () => {
    const fromDemo = await accountsIn(TEST_DEMO_TENANT).find('superadmin');
    const fromPlatform = await accountsIn(TEST_PLATFORM_TENANT).find('superadmin');

    expect(fromDemo).toBeNull();
    expect(fromPlatform).not.toBeNull();
  });
});
