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
});
