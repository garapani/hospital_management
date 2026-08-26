import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { seedPackagesCatalog } from '../packages/seed-packages-catalog.js';

/**
 * Not a real test — a manual, idempotent dev-environment seed, structured as a guarded Jest spec
 * because standalone scripts run via `tsx`/`ts-node` outside Jest currently fail to resolve
 * `@Injectable()`/`@Inject()` decorators in this repo (see Deployment-Guide.md §6, "Known gap"),
 * the same issue `migrate.ts`/`migrate-tenants.ts` hit; Jest's own `@swc/jest` transform (see
 * `.spec.swcrc`) is the one proven-working decorator-safe path until that tooling gap is fixed.
 * Skipped by default so `nx test api` never runs or mutates the dev database as a side effect.
 *
 * Run with: `RUN_SEED_DEV_ACCOUNT=1 pnpm exec nx test api --testFile=seed-dev-account.spec.ts`
 * (from `new/code`), against the docker-compose.dev.yml Postgres. Prints the account's
 * username/password to stdout on success.
 */
const DEV_TENANT_ID = 'demo';
const DEV_USERNAME = 'dev.admin';
const DEV_PASSWORD = 'DevAdmin123!';

const describeIfRequested = process.env['RUN_SEED_DEV_ACCOUNT'] ? describe : describe.skip;

describeIfRequested('seed dev account (manual)', () => {
  let dataSource: DataSource;

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it('provisions the demo tenant and a Super Admin account if they do not already exist', async () => {
    dataSource = createDataSource();
    await dataSource.initialize();

    await seedRbacCatalog(dataSource);
    await seedPackagesCatalog(dataSource);

    const tenantRepository = dataSource.getRepository(Tenant);
    const tenantProvisioning = new TenantProvisioningService(dataSource);
    const existingTenant = await tenantRepository.findOne({ where: { hospitalId: DEV_TENANT_ID } });
    if (!existingTenant) {
      await tenantProvisioning.provisionTenantSchema(DEV_TENANT_ID);
      await tenantRepository.save(
        tenantRepository.create({
          hospitalId: DEV_TENANT_ID,
          hospitalName: 'Demo Hospital',
          status: 'active',
          activatedAt: new Date(),
          suspendedAt: null,
          createdBy: 'seed-dev-account script',
        }),
      );
      console.log(`seed-dev-account: provisioned tenant "${DEV_TENANT_ID}"`);
    }

    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    const accountsService = new AccountsService(tenantConnection, dataSource, tenantContext);

    await tenantContext.run({ tenantId: DEV_TENANT_ID, correlationId: 'seed-dev-account' }, async () => {
      const existingAccount = await accountsService.findByUsernameWithRoles(DEV_USERNAME);
      if (existingAccount) {
        console.log(`seed-dev-account: account "${DEV_USERNAME}" already exists, nothing to do`);
        return;
      }

      await accountsService.createStaffAccount({
        username: DEV_USERNAME,
        email: 'dev.admin@example.com',
        displayName: 'Dev Admin',
        password: DEV_PASSWORD,
        roleName: 'Super Admin',
        needsPasswordUpdate: false,
      });
      console.log(
        `seed-dev-account: created account — tenant="${DEV_TENANT_ID}" username="${DEV_USERNAME}" password="${DEV_PASSWORD}"`,
      );
    });

    const found = await tenantContext.run(
      { tenantId: DEV_TENANT_ID, correlationId: 'seed-dev-account-verify' },
      () => accountsService.findByUsernameWithRoles(DEV_USERNAME),
    );
    expect(found?.roleNames).toContain('Super Admin');
  });
});
