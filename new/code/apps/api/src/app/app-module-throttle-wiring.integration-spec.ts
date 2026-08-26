import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// Regression test for the P1 in code-review-findings-2026-08-25.md ("fraction"/auth section):
// the old three-named-throttler config ('guest'/'authenticated'/'admin') was unconditionally
// stacked on every route (ThrottlerGuard requires ALL configured named throttlers to pass), so the
// tightest of the three ('guest', 20/min) capped the entire API regardless of caller — this wasn't
// specific to auth, it applied to every route in the app. This spec boots the real AppModule (like
// the sibling app-module-auth-wiring.integration-spec.ts) and proves a route can be called more
// than 20 times within the window without tripping a 429.
describe('AppModule throttle wiring (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'app_module_throttle_wiring' });

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

  it('a route can be hit more than 20 times/min without a 429 (no stacked "guest" bucket capping the whole API)', async () => {
    // POST /auth/login itself carries AUTH_RATE_LIMIT_OVERRIDE-free test-mode limit (1,000,000),
    // so any 429 seen here can only come from the module-wide default throttler, not the route's
    // own @Throttle() override.
    for (let i = 0; i < 25; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-tenant-id', ctx.tenantId)
        .send({ username: 'nobody', password: 'wrong' });

      expect(response.status).not.toBe(429);
    }
  });
});
