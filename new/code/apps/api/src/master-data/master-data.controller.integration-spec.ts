import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { MasterDataModule } from './master-data.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('MasterDataController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'masterdata_ctrl', seedRbac: true });
    adminToken = await signTestToken({
      sub: 'master-data-controller-admin',
      hospitalId: ctx.tenantId,
      permissions: ['master-data.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('creates a department and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentCode: 'CTRL1', departmentName: 'Ctrl Cardiology' });

    expect(response.status).toBe(201);
    expect(response.body.departmentCode).toBe('CTRL1');
    expect(response.body.isActive).toBe(true);
  });

  it('rejects a duplicate departmentCode with 409', async () => {
    await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department' });

    const response = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentCode: 'DUP', departmentName: 'Dup Department Again' });

    expect(response.status).toBe(409);
  });

  it('lists departments and gets a single one, 404 for an unknown one', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentCode: 'GETDEPT', departmentName: 'Get Department' });

    const list = await request(app.getHttpServer()).get('/departments').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.some((d: { departmentCode: string }) => d.departmentCode === 'GETDEPT')).toBe(true);

    const found = await request(app.getHttpServer())
      .get(`/departments/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    expect(found.body.departmentName).toBe('Get Department');

    const missing = await request(app.getHttpServer())
      .get('/departments/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it('deactivates and reactivates a department', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ departmentCode: 'LIFECYCLE', departmentName: 'Lifecycle Department' });

    const deactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const reactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.isActive).toBe(true);
  });

  it('creates, lists, and deactivates a ward', async () => {
    const created = await request(app.getHttpServer())
      .post('/wards')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ wardCode: 'W1', wardName: 'Ctrl Ward', bedCapacity: 10 });
    expect(created.status).toBe(201);
    expect(created.body.bedCapacity).toBe(10);

    const list = await request(app.getHttpServer()).get('/wards').set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.some((w: { wardCode: string }) => w.wardCode === 'W1')).toBe(true);

    const deactivated = await request(app.getHttpServer())
      .patch(`/wards/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);
  });

  it('creates a bed under a ward and lists it', async () => {
    const wardResponse = await request(app.getHttpServer())
      .post('/wards')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ wardCode: 'CTRLBED', wardName: 'Ctrl Bed Ward' });
    expect(wardResponse.status).toBe(201);

    const bedResponse = await request(app.getHttpServer())
      .post(`/wards/${wardResponse.body.id}/beds`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ bedNumber: '1', bedType: 'General' });
    expect(bedResponse.status).toBe(201);
    expect(bedResponse.body.wardId).toBe(wardResponse.body.id);

    const listResponse = await request(app.getHttpServer())
      .get(`/wards/${wardResponse.body.id}/beds`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.some((b: { id: string }) => b.id === bedResponse.body.id)).toBe(true);
  });
});
