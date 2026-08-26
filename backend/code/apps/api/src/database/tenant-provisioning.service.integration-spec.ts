import { DataSource } from 'typeorm';
import { createDataSource } from './data-source.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';

describe('TenantProvisioningService (integration)', () => {
  let dataSource: DataSource;
  let service: TenantProvisioningService;
  const tenantId = 'provisioning_svc_test';
  const schemaName = `tenant_${tenantId}`;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    service = new TenantProvisioningService(dataSource);
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await dataSource.query(`DROP ROLE IF EXISTS "${schemaName}"`);
    await dataSource.destroy();
  });

  it('creates the schema, the role, and runs every tenant migration', async () => {
    await service.provisionTenantSchema(tenantId);

    const schemaRows = await dataSource.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [schemaName],
    );
    expect(schemaRows).toHaveLength(1);

    const roleRows = await dataSource.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [schemaName]);
    expect(roleRows).toHaveLength(1);

    // accounts table (from the first tenant migration) exists in the new schema
    const tableRows = await dataSource.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'accounts'`,
      [schemaName],
    );
    expect(tableRows).toHaveLength(1);
  });

  it('grants the role SELECT/INSERT/UPDATE/DELETE on the schema it just created', async () => {
    const grantRows = await dataSource.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = $1 AND table_name = 'accounts' AND grantee = $2
       ORDER BY privilege_type`,
      [schemaName, schemaName],
    );
    const privileges = grantRows.map((r: { privilege_type: string }) => r.privilege_type);
    expect(privileges).toEqual(expect.arrayContaining(['DELETE', 'INSERT', 'SELECT', 'UPDATE']));
  });

  it('grants hospital_db_user membership in the tenant role, so SET ROLE succeeds', async () => {
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.startTransaction();
      await expect(queryRunner.query(`SET LOCAL ROLE "${schemaName}"`)).resolves.not.toThrow();
      await queryRunner.rollbackTransaction();
    } finally {
      await queryRunner.release();
    }
  });

  it('rejects an unsafe tenant id', async () => {
    await expect(service.provisionTenantSchema('bad; DROP TABLE tenants;')).rejects.toThrow(
      'Refusing to provision unsafe tenant id',
    );
  });
});
