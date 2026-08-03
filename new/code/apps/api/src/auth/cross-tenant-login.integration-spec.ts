import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { AuthModule } from './auth.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('Cross-tenant login isolation (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'cross_tenant_login', seedRbac: true });
    tenantB = await ctx.createTenant();

    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'a@example.com',
        displayName: 'Tenant A User',
        password: 'tenant-a-password',
        roleName: 'Doctor',
      }),
    );
    await tenantB.inTenant(() =>
      tenantB.accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'b@example.com',
        displayName: 'Tenant B User',
        password: 'tenant-b-password',
        roleName: 'Nurse',
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .overrideProvider(TenantContextService)
      .useValue(ctx.tenantContext)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(ctx.tenantContext).use.bind(new TenantContextMiddleware(ctx.tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('the same username in two tenants authenticates independently with different passwords', async () => {
    const resA = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'shared.username', password: 'tenant-a-password' });
    expect(resA.status).toBe(200);

    const resB = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', tenantB.tenantId)
      .send({ username: 'shared.username', password: 'tenant-b-password' });
    expect(resB.status).toBe(200);
  });

  it("tenant A's password never authenticates against tenant B's account of the same username", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', tenantB.tenantId)
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    expect(response.status).toBe(401);
  });

  it("a JWT's hospitalId claim reflects only the tenant it was issued under", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    const payload = JSON.parse(
      Buffer.from(response.body.accessToken.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.hospitalId).toBe(ctx.tenantId);
    expect(payload.roles).toEqual(['Doctor']);
  });
});
