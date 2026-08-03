import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TenantsModule } from './tenants.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('TenantsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  const adminHeaders = { 'x-permissions': 'system-admin.tenants.manage' };

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_ctrl', seedRbac: true });

    const moduleRef = await Test.createTestingModule({ imports: [TenantsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`);
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('provisions a tenant and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_create', hospitalName: 'Ctrl Create Hospital' });

    expect(response.status).toBe(201);
    expect(response.body.hospitalId).toBe('test_tenant_ctrl_create');
    expect(response.body.status).toBe('active');
  });

  it('rejects provisioning a duplicate hospitalId with 409', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital' });

    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital Again' });

    expect(response.status).toBe(409);
  });

  it('lists tenants', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_list', hospitalName: 'List Hospital' });

    const response = await request(app.getHttpServer()).get('/tenants').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(
      response.body.some((t: { hospitalId: string }) => t.hospitalId === 'test_tenant_ctrl_list'),
    ).toBe(true);
  });

  it('gets a single tenant, 404 for an unknown one', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_get', hospitalName: 'Get Hospital' });

    const found = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_get')
      .set(adminHeaders);
    expect(found.status).toBe(200);
    expect(found.body.hospitalName).toBe('Get Hospital');

    const missing = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_nonexistent')
      .set(adminHeaders);
    expect(missing.status).toBe(404);
  });

  it('suspends and reactivates a tenant', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set(adminHeaders)
      .send({ hospitalId: 'test_tenant_ctrl_lifecycle', hospitalName: 'Lifecycle Hospital' });

    const suspended = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/suspend')
      .set(adminHeaders);
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const reactivated = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/reactivate')
      .set(adminHeaders);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('active');
  });
});
