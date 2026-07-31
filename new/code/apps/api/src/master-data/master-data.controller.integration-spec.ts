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

describe('MasterDataController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const adminHeaders = {
    'x-tenant-id': 'test_masterdata_ctrl',
    'x-permissions': 'master-data.manage',
  };

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
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_masterdata_ctrl');

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_masterdata_ctrl" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('creates a department and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'CTRL1', departmentName: 'Ctrl Cardiology' });

    expect(response.status).toBe(201);
    expect(response.body.departmentCode).toBe('CTRL1');
    expect(response.body.isActive).toBe(true);
  });

  it('rejects a duplicate departmentCode with 409', async () => {
    await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department' });

    const response = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department Again' });

    expect(response.status).toBe(409);
  });

  it('lists departments and gets a single one, 404 for an unknown one', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'GETDEPT', departmentName: 'Get Department' });

    const list = await request(app.getHttpServer()).get('/departments').set(adminHeaders);
    expect(list.status).toBe(200);
    expect(list.body.some((d: { departmentCode: string }) => d.departmentCode === 'GETDEPT')).toBe(true);

    const found = await request(app.getHttpServer())
      .get(`/departments/${created.body.id}`)
      .set(adminHeaders);
    expect(found.status).toBe(200);
    expect(found.body.departmentName).toBe('Get Department');

    const missing = await request(app.getHttpServer())
      .get('/departments/00000000-0000-0000-0000-000000000000')
      .set(adminHeaders);
    expect(missing.status).toBe(404);
  });

  it('deactivates and reactivates a department', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set(adminHeaders)
      .send({ departmentCode: 'LIFECYCLE', departmentName: 'Lifecycle Department' });

    const deactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/deactivate`)
      .set(adminHeaders);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const reactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/reactivate`)
      .set(adminHeaders);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.isActive).toBe(true);
  });

  it('creates, lists, and deactivates a ward', async () => {
    const created = await request(app.getHttpServer())
      .post('/wards')
      .set(adminHeaders)
      .send({ wardCode: 'W1', wardName: 'Ctrl Ward', bedCapacity: 10 });
    expect(created.status).toBe(201);
    expect(created.body.bedCapacity).toBe(10);

    const list = await request(app.getHttpServer()).get('/wards').set(adminHeaders);
    expect(list.status).toBe(200);
    expect(list.body.some((w: { wardCode: string }) => w.wardCode === 'W1')).toBe(true);

    const deactivated = await request(app.getHttpServer())
      .patch(`/wards/${created.body.id}/deactivate`)
      .set(adminHeaders);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);
  });

  it('creates a bed under a ward and lists it', async () => {
    const wardResponse = await request(app.getHttpServer())
      .post('/wards')
      .set(adminHeaders)
      .send({ wardCode: 'CTRLBED', wardName: 'Ctrl Bed Ward' });
    expect(wardResponse.status).toBe(201);

    const bedResponse = await request(app.getHttpServer())
      .post(`/wards/${wardResponse.body.id}/beds`)
      .set(adminHeaders)
      .send({ bedNumber: '1', bedType: 'General' });
    expect(bedResponse.status).toBe(201);
    expect(bedResponse.body.wardId).toBe(wardResponse.body.id);

    const listResponse = await request(app.getHttpServer())
      .get(`/wards/${wardResponse.body.id}/beds`)
      .set(adminHeaders);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((b: { id: string }) => b.id === bedResponse.body.id)).toBe(true);
  });
});
