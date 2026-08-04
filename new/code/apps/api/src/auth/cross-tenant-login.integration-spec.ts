import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { AuthModule } from './auth.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { resolveJwtSecret } from './jwt-secret.js';

// POST /auth/login and POST /auth/refresh are excluded from AuthContextMiddleware in production
// (see AppModule.configure()) — no prior JWT can exist at login, and refresh authenticates via
// the refresh token itself, not an access token. This manually-constructed test app doesn't go
// through AppModule.configure(), so the exclusion is reproduced here to keep behavior identical.
function isAuthContextExcludedRoute(req: Request): boolean {
  return req.method === 'POST' && (req.path === '/auth/login' || req.path === '/auth/refresh');
}

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

    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (isAuthContextExcludedRoute(req)) {
        next();
        return;
      }
      authContextMiddleware.use(req, res, next);
    });
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
