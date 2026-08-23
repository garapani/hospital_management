import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

export interface TenantTestContext {
  dataSource: DataSource;
  tenantContext: TenantContextService;
  tenantConnection: TenantConnectionService;
  accountsService: AccountsService;
  tenantId: string;
  inTenant<T>(work: () => Promise<T>): Promise<T>;
  createTenant(): Promise<TenantTestContext>;
}

export interface TenantTestContextOptions {
  namePrefix: string;
  seedRbac?: boolean;
}

const tenantRegistry = new WeakMap<DataSource, string[]>();

function registerTenant(dataSource: DataSource, tenantId: string): void {
  const ids = tenantRegistry.get(dataSource) ?? [];
  ids.push(tenantId);
  tenantRegistry.set(dataSource, ids);
}

async function provisionTenant(
  dataSource: DataSource,
  tenantProvisioning: TenantProvisioningService,
  tenantId: string,
): Promise<void> {
  // Idempotent: drops any schema/role left behind by a crashed prior run before creating a fresh
  // one, so deterministic sequential IDs (namePrefix_1, namePrefix_2, ...) never collide.
  await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  await dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
  registerTenant(dataSource, tenantId);
  await tenantProvisioning.provisionTenantSchema(tenantId);
}

function buildContext(
  dataSource: DataSource,
  tenantContext: TenantContextService,
  tenantConnection: TenantConnectionService,
  tenantProvisioning: TenantProvisioningService,
  accountsService: AccountsService,
  namePrefix: string,
  sequence: { next: number },
): TenantTestContext {
  const tenantId = `${namePrefix}_${sequence.next}`;

  return {
    dataSource,
    tenantContext,
    tenantConnection,
    accountsService,
    tenantId,
    inTenant<T>(work: () => Promise<T>): Promise<T> {
      return tenantContext.run({ tenantId, correlationId: 'test' }, work);
    },
    async createTenant(): Promise<TenantTestContext> {
      sequence.next += 1;
      const nextCtx = buildContext(
        dataSource,
        tenantContext,
        tenantConnection,
        tenantProvisioning,
        accountsService,
        namePrefix,
        sequence,
      );
      await provisionTenant(dataSource, tenantProvisioning, nextCtx.tenantId);
      return nextCtx;
    },
  };
}

export async function setupTenantTestContext(
  options: TenantTestContextOptions,
): Promise<TenantTestContext> {
  if (!/^[a-z0-9_]+$/.test(options.namePrefix)) {
    throw new Error(`namePrefix must match /^[a-z0-9_]+$/ (got: ${options.namePrefix})`);
  }

  const dataSource = createDataSource();
  await dataSource.initialize();

  if (options.seedRbac) {
    await seedRbacCatalog(dataSource);
  }

  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const tenantProvisioning = new TenantProvisioningService(dataSource);
  const accountsService = new AccountsService(tenantConnection, dataSource, tenantContext);
  const sequence = { next: 1 };

  const ctx = buildContext(
    dataSource,
    tenantContext,
    tenantConnection,
    tenantProvisioning,
    accountsService,
    options.namePrefix,
    sequence,
  );
  await provisionTenant(dataSource, tenantProvisioning, ctx.tenantId);

  return ctx;
}

export async function teardownTenantTestContext(ctx?: TenantTestContext): Promise<void> {
  if (ctx?.dataSource?.isInitialized) {
    const tenantIds = tenantRegistry.get(ctx.dataSource) ?? [ctx.tenantId];
    for (const tenantId of tenantIds) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "tenant_${tenantId}"`);
    }
    tenantRegistry.delete(ctx.dataSource);
    await ctx.dataSource.destroy();
  }
}
