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

// POST /auth/login, POST /auth/refresh and POST /auth/change-password are excluded from
// AuthContextMiddleware in production (see AppModule.configure()) — no prior JWT can exist at
// login, refresh authenticates via the refresh token itself (not an access token), and the
// must-change-password onboarding authenticates with username + current password because login
// issues no tokens for flagged accounts. This manually-constructed test app doesn't go through
// AppModule.configure(), so the exclusions are reproduced here to keep behavior identical.
function isAuthContextExcludedRoute(req: Request): boolean {
  return (
    req.method === 'POST' &&
    (req.path === '/auth/login' ||
      req.path === '/auth/refresh' ||
      req.path === '/auth/change-password')
  );
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'auth_controller', seedRbac: true });
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dr.dave',
        email: 'dave@example.com',
        displayName: 'Dr. Dave',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
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

  it('returns tokens for correct credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'dr.dave', password: 'correct-password-123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
  });

  it('returns 401 with a generic message for wrong credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'dr.dave', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid username or password');
  });

  it('POST /auth/refresh issues a new access token from a valid refresh token', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'dr.dave', password: 'correct-password-123' });
    expect(loginResponse.status).toBe(200);

    // JWT `iat` has second-level granularity: without this delay, a refresh issued in the same
    // wall-clock second as login would sign an identical payload and produce a byte-identical
    // token, making the "rotated" assertion below flaky rather than a real behavior check.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-tenant-id', ctx.tenantId)
      .send({ refreshToken: loginResponse.body.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(typeof refreshResponse.body.accessToken).toBe('string');
    expect(typeof refreshResponse.body.refreshToken).toBe('string');
    expect(refreshResponse.body.refreshToken).not.toBe(loginResponse.body.refreshToken);
  });

  it('POST /auth/refresh returns 401 for an invalid refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-tenant-id', ctx.tenantId)
      .send({ refreshToken: 'not-a-real-token' });

    expect(response.status).toBe(401);
  });

  describe('must-change-password onboarding over HTTP', () => {
    beforeAll(async () => {
      await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'new.hire',
          email: 'newhire@example.com',
          displayName: 'New Hire',
          password: 'initial-pass-123',
          needsPasswordUpdate: true,
          roleName: 'Nurse',
        }),
      );
      // Stays flagged for the failure-path tests below; new.hire's own flag is cleared by the
      // success test, which would otherwise change which error those tests hit first.
      await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'new.hire2',
          email: 'newhire2@example.com',
          displayName: 'New Hire Two',
          password: 'initial-pass-456',
          needsPasswordUpdate: true,
          roleName: 'Nurse',
        }),
      );
    });

    it('login with the initial password returns 403 mustChangePassword and no tokens', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-tenant-id', ctx.tenantId)
        .send({ username: 'new.hire', password: 'initial-pass-123' });

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ mustChangePassword: true });
      expect(response.body.accessToken).toBeUndefined();
      expect(response.body.refreshToken).toBeUndefined();
    });

    it('POST /auth/change-password succeeds with the current password and unlocks login', async () => {
      const changeResponse = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('x-tenant-id', ctx.tenantId)
        .send({
          username: 'new.hire',
          currentPassword: 'initial-pass-123',
          newPassword: 'brand-new-pass-456',
        });

      expect(changeResponse.status).toBe(200);
      expect(changeResponse.body).toEqual({ success: true });

      const loginWithNew = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-tenant-id', ctx.tenantId)
        .send({ username: 'new.hire', password: 'brand-new-pass-456' });
      expect(loginWithNew.status).toBe(200);
      expect(loginWithNew.body).toMatchObject({ accessToken: expect.any(String) });

      const loginWithOld = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-tenant-id', ctx.tenantId)
        .send({ username: 'new.hire', password: 'initial-pass-123' });
      expect(loginWithOld.status).toBe(401);
    });

    it('POST /auth/change-password rejects a wrong current password with 401', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('x-tenant-id', ctx.tenantId)
        .send({
          username: 'new.hire2',
          currentPassword: 'wrong-current',
          newPassword: 'whatever-new-123',
        });

      expect(response.status).toBe(401);
    });

    it('POST /auth/change-password rejects an account not flagged must-change with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('x-tenant-id', ctx.tenantId)
        .send({
          username: 'dr.dave',
          currentPassword: 'correct-password-123',
          newPassword: 'whatever-new-123',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('not required to change');
    });

    it('POST /auth/change-password rejects a short new password with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('x-tenant-id', ctx.tenantId)
        .send({
          username: 'new.hire2',
          currentPassword: 'initial-pass-456',
          newPassword: 'short',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 8 characters');
    });
  });
});
