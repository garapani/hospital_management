import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// Unlike auth.controller.integration-spec.ts and cross-tenant-login.integration-spec.ts, which
// hand-roll their own isAuthContextExcludedRoute() predicate on a manually-built Express app, this
// spec boots the real AppModule (no manual middleware wiring, no guard overrides) to prove the
// production `.exclude(...)` config in AppModule.configure() actually behaves as documented.
describe('AppModule auth-exclusion wiring (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'app_module_auth_wiring' });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('POST /auth/login is excluded from AuthContextMiddleware: an unauthenticated request reaches the controller', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'nobody', password: 'wrong' });

    // Invalid credentials legitimately produce a 401 from the controller itself — status code
    // alone can't distinguish that from AuthContextMiddleware's own 401. The message can:
    // AuthContextMiddleware rejects with 'Missing or malformed Authorization header', while the
    // controller rejects bad credentials with a different, generic message. Seeing the latter
    // proves the request was never intercepted by the auth middleware.
    expect(response.body.message).toBe('Invalid username or password');
    expect(response.body.message).not.toBe('Missing or malformed Authorization header');
  });

  it('GET /auth/login (wrong method, same path) is NOT excluded: AuthContextMiddleware rejects it with 401', async () => {
    const response = await request(app.getHttpServer()).get('/auth/login');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Missing or malformed Authorization header');
  });

  it('GET /patients (a protected route) with no Authorization header returns 401', async () => {
    const response = await request(app.getHttpServer()).get('/patients');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Missing or malformed Authorization header');
  });

  it('GET /branding is excluded from AuthContextMiddleware: the login page can render branding pre-session', async () => {
    const response = await request(app.getHttpServer())
      .get('/branding')
      .set('x-tenant-id', ctx.tenantId);

    // No Authorization header at all — a 200 (not 401) proves the request reached
    // TenantBrandingController rather than being rejected by the auth middleware. An unconfigured
    // tenant resolves to all-null (the frontend's default-Vaidya-brand case), not an error.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      displayName: null,
      primaryColor: null,
      logoUrl: null,
      tagline: null,
      description: null,
      footerText: null,
      supportText: null,
    });
  });

  it('POST /branding (wrong method, same path — no such route) is NOT excluded: AuthContextMiddleware rejects it with 401', async () => {
    const response = await request(app.getHttpServer()).post('/branding');

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Missing or malformed Authorization header');
  });
});
