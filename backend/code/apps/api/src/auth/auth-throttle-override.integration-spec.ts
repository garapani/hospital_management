import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import request from 'supertest';
import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// Regression test for the P1 in code-review-findings-2026-08-25.md: AuthController's
// @Throttle({ default: {...} }) named a bucket that didn't exist in the module's throttler config
// ('guest'/'authenticated'/'admin'), so the override was silently ignored. AUTH_RATE_LIMIT is
// normally forced to 1,000,000 in test mode (see auth.controller.ts) so the rest of the suite
// never trips the guard incidentally — this spec sets AUTH_RATE_LIMIT_OVERRIDE and imports
// AuthController fresh (dynamic import, after the env var is set) to get a real, small limit and
// prove the @Throttle() override actually constrains requests, distinct from and tighter than the
// module's own base 'default' limit configured below.
describe('AuthController @Throttle override (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  const originalOverride = process.env['AUTH_RATE_LIMIT_OVERRIDE'];

  beforeAll(async () => {
    process.env['AUTH_RATE_LIMIT_OVERRIDE'] = '3';

    const { AuthModule } = await import('./auth.module.js');

    ctx = await setupTenantTestContext({ namePrefix: 'auth_throttle_override' });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        // Base limit (1000) is deliberately far above the 3-request override so a 429 here can
        // only be explained by the route's own @Throttle() override actually taking effect.
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 1000 }]),
        AuthModule,
      ],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .overrideProvider(TenantContextService)
      .useValue(ctx.tenantContext)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.use(
      new TenantContextMiddleware(ctx.tenantContext).use.bind(new TenantContextMiddleware(ctx.tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
    if (originalOverride === undefined) {
      delete process.env['AUTH_RATE_LIMIT_OVERRIDE'];
    } else {
      process.env['AUTH_RATE_LIMIT_OVERRIDE'] = originalOverride;
    }
  });

  it('the 4th login attempt within the window is throttled (429) even though the module default allows 1000', async () => {
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-tenant-id', ctx.tenantId)
        .send({ username: 'nobody', password: 'wrong' });

      expect(response.status).not.toBe(429);
    }

    const fourth = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: 'nobody', password: 'wrong' });

    expect(fourth.status).toBe(429);
  });
});
