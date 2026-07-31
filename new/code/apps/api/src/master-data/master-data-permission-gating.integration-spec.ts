import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { MasterDataModule } from './master-data.module.js';
import { MasterDataService } from './master-data.service.js';

describe('MasterDataController permission gating (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let departmentId: string;

  const noPermissionHeaders = { 'x-tenant-id': 'test_masterdata_permgate' };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const tenantConnection = moduleRef.get(TenantConnectionService);
    const masterDataService = moduleRef.get(MasterDataService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_permgate');

    const department = await tenantContext.run(
      { tenantId: 'test_masterdata_permgate', correlationId: 'setup' },
      () =>
        masterDataService.createDepartment({
          departmentCode: 'PERMGATE',
          departmentName: 'Permission Gate Department',
        }),
    );
    departmentId = department.id;

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_permgate" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('rejects creating a department with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(noPermissionHeaders)
      .send({ departmentCode: 'BLOCKED', departmentName: 'Blocked Department' });
    expect(response.status).toBe(403);
  });

  it('rejects listing departments with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/departments').set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single department with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get(`/departments/${departmentId}`)
      .set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects department deactivate/reactivate with 403 when no master-data.manage permission is granted', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/deactivate`)
      .set(noPermissionHeaders);
    expect(deactivateResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/reactivate`)
      .set(noPermissionHeaders);
    expect(reactivateResponse.status).toBe(403);
  });

  it('rejects creating and listing wards with 403 when no master-data.manage permission is granted', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/wards')
      .set(noPermissionHeaders)
      .send({ wardCode: 'BLOCKED', wardName: 'Blocked Ward' });
    expect(createResponse.status).toBe(403);

    const listResponse = await request(app.getHttpServer()).get('/wards').set(noPermissionHeaders);
    expect(listResponse.status).toBe(403);
  });
});
