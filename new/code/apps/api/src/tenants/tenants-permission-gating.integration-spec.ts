import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { TenantsModule } from './tenants.module.js';
import { TenantsService } from './tenants.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('TenantsController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let noPermissionToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_permgate', seedRbac: true });
    noPermissionToken = await signTestToken({
      sub: 'tenants-permgate-user',
      hospitalId: ctx.tenantId,
    });

    const moduleRef = await Test.createTestingModule({ imports: [TenantsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantsService = moduleRef.get(TenantsService);
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_permgate',
      hospitalName: 'Permission Gate Hospital',
    });

    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    await app.init();
  });

  afterAll(async () => {
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = 'test_tenant_permgate'`);
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('rejects provisioning with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({ hospitalId: 'blocked_tenant', hospitalName: 'Blocked Hospital' });
    expect(response.status).toBe(403);
  });

  it('rejects listing tenants with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single tenant with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get('/tenants/test_tenant_permgate')
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects suspend/reactivate with 403 when no system-admin.tenants.manage permission is granted', async () => {
    const suspendResponse = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_permgate/suspend')
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(suspendResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_permgate/reactivate')
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(reactivateResponse.status).toBe(403);
  });
});
