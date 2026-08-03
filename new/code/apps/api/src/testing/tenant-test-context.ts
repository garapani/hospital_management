import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
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

// Keyed by the shared DataSource instance (identical across a root context and every context it
// produces via createTenant()) — this is what lets teardownTenantTestContext() drop every tenant
// schema created in a multi-tenant test with a single call, and destroy the connection exactly
// once regardless of how many tenants were created.
const tenantRegistry = new WeakMap<DataSource, string[]>();

function registerTenant(dataSource: DataSource, tenantId: string): void {
  const ids = tenantRegistry.get(dataSource) ?? [];
  ids.push(tenantId);
  tenantRegistry.set(dataSource, ids);
}

async function provisionTenant(
  dataSource: DataSource,
  accountsService: AccountsService,
  tenantId: string,
): Promise<void> {
  // Idempotent: drops any schema left behind by a crashed prior run before creating a fresh one,
  // so deterministic sequential IDs (namePrefix_1, namePrefix_2, ...) never collide across runs.
  await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  // Register before provisioning, not after: if provisionTenantSchema() throws partway through,
  // the partially-created schema is still registered for teardown to drop.
  registerTenant(dataSource, tenantId);
  await accountsService.provisionTenantSchema(dataSource, tenantId);
}

function buildContext(
  dataSource: DataSource,
  tenantContext: TenantContextService,
  tenantConnection: TenantConnectionService,
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
        accountsService,
        namePrefix,
        sequence,
      );
      await provisionTenant(dataSource, accountsService, nextCtx.tenantId);
      return nextCtx;
    },
  };
}

export async function setupTenantTestContext(
  options: TenantTestContextOptions,
): Promise<TenantTestContext> {
  // Validate before anything else: the tenant id derived from namePrefix is interpolated straight
  // into a DROP SCHEMA statement in provisionTenant(), which runs before AccountsService's own
  // safety check would ever see it.
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
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const sequence = { next: 1 };

  const ctx = buildContext(
    dataSource,
    tenantContext,
    tenantConnection,
    accountsService,
    options.namePrefix,
    sequence,
  );
  await provisionTenant(dataSource, accountsService, ctx.tenantId);

  return ctx;
}

export async function teardownTenantTestContext(ctx: TenantTestContext): Promise<void> {
  // Guard the whole body, not just destroy(): a second teardown call on an already-torn-down
  // context must no-op rather than throw on .query() against a destroyed DataSource.
  if (ctx.dataSource.isInitialized) {
    const tenantIds = tenantRegistry.get(ctx.dataSource) ?? [ctx.tenantId];
    for (const tenantId of tenantIds) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
    }
    tenantRegistry.delete(ctx.dataSource);
    await ctx.dataSource.destroy();
  }
}
