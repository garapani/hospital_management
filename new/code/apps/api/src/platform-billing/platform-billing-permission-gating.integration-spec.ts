import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { PlatformBillingModule } from './platform-billing.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

const PREFIX = 'test_billing_http_';

describe('PlatformBillingController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let noPermissionToken: string;
  let platformToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'billing_http', seedRbac: true });
    noPermissionToken = await signTestToken({
      sub: 'billing-http-user',
      hospitalId: ctx.tenantId,
    });
    platformToken = await signTestToken({
      sub: 'billing-http-platform',
      hospitalId: ctx.tenantId,
      permissions: ['system-admin.tenants.manage'],
    });

    await ctx.dataSource.query(
      `INSERT INTO tenants ("hospitalId", "hospitalName", "status", "packageCode", "createdBy", "activatedAt")
       VALUES ($1, 'Billing HTTP Hospital', 'active', 'basic', 'billing-http-spec', NOW())`,
      [`${PREFIX}hospital`],
    );

    const moduleRef = await Test.createTestingModule({ imports: [PlatformBillingModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);

    app = moduleRef.createNestApplication();
    const jwtService = new JwtService({ secret: resolveJwtSecret() });
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await ctx.dataSource.query(`DELETE FROM subscription_invoices WHERE "tenantId" LIKE '${PREFIX}%'`);
    await ctx.dataSource.query(`DELETE FROM subscriptions WHERE "tenantId" LIKE '${PREFIX}%'`);
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE '${PREFIX}%'`);
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('rejects every billing route with 403 without system-admin.tenants.manage', async () => {
    const routes = [
      ['get', '/platform/billing/subscriptions'],
      ['get', `/platform/billing/tenants/${PREFIX}hospital/subscription`],
      ['post', `/platform/billing/tenants/${PREFIX}hospital/subscribe`],
      ['post', `/platform/billing/tenants/${PREFIX}hospital/invoices`],
    ] as const;
    for (const [method, path] of routes) {
      const response = await request(app.getHttpServer())
        [method](path)
        .set('Authorization', `Bearer ${noPermissionToken}`)
        .send(method === 'post' ? { billingCycle: 'monthly' } : undefined);
      expect(response.status).toBe(403);
    }
  });

  it('subscribes, invoices, and marks paid end to end with the platform permission', async () => {
    const subscribe = await request(app.getHttpServer())
      .post(`/platform/billing/tenants/${PREFIX}hospital/subscribe`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ billingCycle: 'monthly' });
    expect(subscribe.status).toBe(201);
    expect(subscribe.body.pricePerCycle).toBe(4999);

    const invoice = await request(app.getHttpServer())
      .post(`/platform/billing/tenants/${PREFIX}hospital/invoices`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(invoice.status).toBe(201);
    expect(invoice.body.amount).toBe(4999);

    const paid = await request(app.getHttpServer())
      .post(`/platform/billing/invoices/${invoice.body.id}/paid`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(paid.status).toBe(201);
    expect(paid.body.status).toBe('paid');

    const list = await request(app.getHttpServer())
      .get(`/platform/billing/tenants/${PREFIX}hospital/invoices`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });
});
