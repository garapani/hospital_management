import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('TenantConnectionService (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_connection' });

    for (const schema of ['tenant_test_a', 'tenant_test_b']) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await ctx.dataSource.query(`CREATE SCHEMA "${schema}"`);
      await ctx.dataSource.query(
        `CREATE TABLE "${schema}".probe (id serial primary key, label text not null)`,
      );
    }
    await ctx.dataSource.query(`INSERT INTO tenant_test_a.probe (label) VALUES ('a-row')`);
    await ctx.dataSource.query(`INSERT INTO tenant_test_b.probe (label) VALUES ('b-row')`);
  });

  afterAll(async () => {
    await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_a" CASCADE`);
    await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_b" CASCADE`);
    await teardownTenantTestContext(ctx);
  });

  // This file intentionally uses ctx.tenantContext.run(...) directly, not ctx.inTenant(...), in
  // every test below: ctx.inTenant() is hardcoded to ctx.tenantId, but these tests need arbitrary
  // literal tenant ids (test_a/test_b, and a SQL-injection probe string) that don't match it.
  it('only sees the current tenant context schema\'s data', async () => {
    const rowsForA = await ctx.tenantContext.run(
      { tenantId: 'test_a', correlationId: 'c1' },
      () => ctx.tenantConnection.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForA).toEqual([{ label: 'a-row' }]);

    const rowsForB = await ctx.tenantContext.run(
      { tenantId: 'test_b', correlationId: 'c2' },
      () => ctx.tenantConnection.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForB).toEqual([{ label: 'b-row' }]);
  });

  it('throws when no tenant context is set', async () => {
    await expect(ctx.tenantConnection.runInTenantSchema((manager) => manager.query('SELECT 1'))).rejects.toThrow(
      'No tenant context set',
    );
  });

  it('rejects a schema name that is not safe to interpolate into SQL', async () => {
    await expect(
      ctx.tenantContext.run({ tenantId: 'bad"; DROP TABLE probe; --', correlationId: 'c3' }, () =>
        ctx.tenantConnection.runInTenantSchema((manager) => manager.query('SELECT 1')),
      ),
    ).rejects.toThrow('Refusing to use unsafe schema name');
  });
});
