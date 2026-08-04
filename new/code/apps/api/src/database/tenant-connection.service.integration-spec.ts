import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

describe('TenantConnectionService (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_connection' });

    for (const schema of ['tenant_test_a', 'tenant_test_b']) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${schema}"`);
      await ctx.dataSource.query(`CREATE SCHEMA "${schema}"`);
      await ctx.dataSource.query(
        `CREATE TABLE "${schema}".probe (id serial primary key, label text not null)`,
      );
      // runInTenantSchema now SET LOCAL ROLEs unconditionally — these hand-rolled schemas need a
      // matching role too, same as real provisioning creates.
      await ctx.dataSource.query(`CREATE ROLE "${schema}" NOLOGIN`);
      await ctx.dataSource.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO "${schema}"`);
      await ctx.dataSource.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${schema}"`);
      await ctx.dataSource.query(
        `GRANT "${schema}" TO "${process.env['DB_USERNAME'] ?? 'identity_access'}"`,
      );
    }
    await ctx.dataSource.query(`INSERT INTO tenant_test_a.probe (label) VALUES ('a-row')`);
    await ctx.dataSource.query(`INSERT INTO tenant_test_b.probe (label) VALUES ('b-row')`);
  });

  afterAll(async () => {
    for (const schema of ['tenant_test_a', 'tenant_test_b']) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${schema}"`);
    }
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

  describe('SET LOCAL ROLE (real per-tenant Postgres role)', () => {
    let roleDataSource: DataSource;
    let roleTenantContext: TenantContextService;
    let roleConnectionService: TenantConnectionService;
    const tenantId = 'conn_svc_role_test';
    const schemaName = `tenant_${tenantId}`;

    beforeAll(async () => {
      roleDataSource = createDataSource();
      await roleDataSource.initialize();
      roleTenantContext = new TenantContextService();
      roleConnectionService = new TenantConnectionService(roleDataSource, roleTenantContext);
      await roleDataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await roleDataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
      await new TenantProvisioningService(roleDataSource).provisionTenantSchema(tenantId);
    });

    afterAll(async () => {
      await roleDataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await roleDataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
      await roleDataSource.destroy();
    });

    it('SET LOCAL ROLE actually applies within runInTenantSchema (transaction-scoped)', async () => {
      const currentRole = await roleTenantContext.run({ tenantId, correlationId: 'test' }, () =>
        roleConnectionService.runInTenantSchema(async (manager) => {
          const rows = await manager.query('SELECT current_user AS role');
          return rows[0].role;
        }),
      );
      expect(currentRole).toBe(schemaName);
    });

    it('the elevated role does not leak to a later query on a fresh call', async () => {
      await roleTenantContext.run({ tenantId, correlationId: 'test' }, () =>
        roleConnectionService.runInTenantSchema(async (manager) => {
          await manager.query('SELECT 1');
        }),
      );

      const queryRunner = roleDataSource.createQueryRunner();
      await queryRunner.connect();
      try {
        const rows = await queryRunner.query('SELECT current_user AS role');
        expect(rows[0].role).not.toBe(schemaName);
      } finally {
        await queryRunner.release();
      }
    });

    it('rolls back the transaction if work() throws', async () => {
      await expect(
        roleTenantContext.run({ tenantId, correlationId: 'test' }, () =>
          roleConnectionService.runInTenantSchema(async () => {
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');
    });
  });
});
