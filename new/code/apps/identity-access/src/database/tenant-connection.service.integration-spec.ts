import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';

describe('TenantConnectionService (integration)', () => {
  const dataSource = createDataSource();
  let tenantContext: TenantContextService;
  let service: TenantConnectionService;

  beforeAll(async () => {
    await dataSource.initialize();
    tenantContext = new TenantContextService();
    service = new TenantConnectionService(dataSource, tenantContext);

    for (const schema of ['tenant_test_a', 'tenant_test_b']) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dataSource.query(`CREATE SCHEMA "${schema}"`);
      await dataSource.query(
        `CREATE TABLE "${schema}".probe (id serial primary key, label text not null)`,
      );
    }
    await dataSource.query(`INSERT INTO tenant_test_a.probe (label) VALUES ('a-row')`);
    await dataSource.query(`INSERT INTO tenant_test_b.probe (label) VALUES ('b-row')`);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_a" CASCADE`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_b" CASCADE`);
    await dataSource.destroy();
  });

  it('only sees the current tenant context schema\'s data', async () => {
    const rowsForA = await tenantContext.run(
      { tenantId: 'test_a', correlationId: 'c1' },
      () => service.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForA).toEqual([{ label: 'a-row' }]);

    const rowsForB = await tenantContext.run(
      { tenantId: 'test_b', correlationId: 'c2' },
      () => service.runInTenantSchema((manager) => manager.query('SELECT label FROM probe')),
    );
    expect(rowsForB).toEqual([{ label: 'b-row' }]);
  });

  it('throws when no tenant context is set', async () => {
    await expect(service.runInTenantSchema((manager) => manager.query('SELECT 1'))).rejects.toThrow(
      'No tenant context set',
    );
  });

  it('rejects a schema name that is not safe to interpolate into SQL', async () => {
    await expect(
      tenantContext.run({ tenantId: 'bad"; DROP TABLE probe; --', correlationId: 'c3' }, () =>
        service.runInTenantSchema((manager) => manager.query('SELECT 1')),
      ),
    ).rejects.toThrow('Refusing to use unsafe schema name');
  });
});
