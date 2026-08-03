import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from './tenant-test-context.js';

describe('TenantTestContext (integration)', () => {
  it('provisions a schema at a sequential tenant ID and tears it down', async () => {
    const ctx: TenantTestContext = await setupTenantTestContext({ namePrefix: 'tt_basic' });
    expect(ctx.tenantId).toBe('tt_basic_1');

    const schemas = await ctx.dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_tt_basic_1'`,
    );
    expect(schemas).toHaveLength(1);

    await teardownTenantTestContext(ctx);

    // Re-initialize a throwaway connection to check the schema is really gone — ctx.dataSource
    // is destroyed at this point.
    const check = new DataSource({ ...(ctx.dataSource.options as any) });
    await check.initialize();
    const after = await check.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_tt_basic_1'`,
    );
    expect(after).toHaveLength(0);
    expect(ctx.dataSource.isInitialized).toBe(false);
    await check.destroy();
  });

  it('runs work inside the correct tenant context via inTenant()', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_context' });
    try {
      const seenTenantId = await ctx.inTenant(async () => ctx.tenantContext.getTenantId());
      expect(seenTenantId).toBe('tt_context_1');
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('seeds the RBAC catalog when seedRbac is true', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_rbac', seedRbac: true });
    try {
      const roleCount = await ctx.dataSource.query(`SELECT count(*)::int FROM public.roles`);
      expect(roleCount[0].count).toBeGreaterThan(0);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('does not seed RBAC when seedRbac is omitted', async () => {
    // `public.roles` is a platform-wide, cross-tenant catalog (not schema-scoped per tenant —
    // see seed-rbac-catalog.ts), so it is not reset between test files on this repo's shared,
    // persistent local Postgres instance. Other integration specs legitimately seed it. So this
    // asserts the relative invariant that matters here — that omitting `seedRbac` does not add to
    // the catalog — rather than an absolute row count of 0, which would be unreliable outside of
    // a pristine, never-seeded database.
    const probe = createDataSource();
    await probe.initialize();
    const before = await probe.query(`SELECT count(*)::int FROM public.roles`);
    await probe.destroy();

    const ctx = await setupTenantTestContext({ namePrefix: 'tt_norbac' });
    try {
      const roleCount = await ctx.dataSource.query(`SELECT count(*)::int FROM public.roles`);
      expect(roleCount[0].count).toBe(before[0].count);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('createTenant() produces sequential tenant IDs sharing the same connection', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_multi' });
    try {
      const ctx2 = await ctx.createTenant();
      const ctx3 = await ctx.createTenant();

      expect(ctx2.tenantId).toBe('tt_multi_2');
      expect(ctx3.tenantId).toBe('tt_multi_3');
      expect(ctx2.dataSource).toBe(ctx.dataSource);

      const schemas = await ctx.dataSource.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_tt_multi_1', 'tenant_tt_multi_2', 'tenant_tt_multi_3') ORDER BY schema_name`,
      );
      expect(schemas).toHaveLength(3);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('teardown drops every tenant schema created via createTenant(), not just the root', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_teardown_multi' });
    const ctx2 = await ctx.createTenant();
    void ctx2;

    await teardownTenantTestContext(ctx);

    const check = new DataSource({ ...(ctx.dataSource.options as any) });
    await check.initialize();
    const remaining = await check.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_tt_teardown_multi_1', 'tenant_tt_teardown_multi_2')`,
    );
    expect(remaining).toHaveLength(0);
    await check.destroy();
  });

  it('self-heals: setupTenantTestContext succeeds even if a same-named schema already exists from a crashed prior run', async () => {
    const ctx1 = await setupTenantTestContext({ namePrefix: 'tt_crash' });
    // Simulate a crashed run: leave the schema behind, do NOT call teardown, destroy only the
    // connection so a second setup can open a fresh one against the same DB.
    await ctx1.dataSource.destroy();

    const ctx2 = await setupTenantTestContext({ namePrefix: 'tt_crash' });
    try {
      expect(ctx2.tenantId).toBe('tt_crash_1');
      const roleCount = await ctx2.dataSource.query(
        `SELECT count(*)::int FROM information_schema.schemata WHERE schema_name = 'tenant_tt_crash_1'`,
      );
      expect(roleCount[0].count).toBe(1);
    } finally {
      await teardownTenantTestContext(ctx2);
    }
  });
});
