import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import { setupTenantTestContext, teardownTenantTestContext, TenantTestContext } from '../testing/tenant-test-context.js';

describe('Metrics endpoint (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    ctx = await setupTenantTestContext({ namePrefix: 'metrics' });
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('serves /metrics without auth in the Prometheus text format', async () => {
    // The module has no global prefix (that lives in main.ts's bootstrap), so the route is /metrics.
    const res = await request(app.getHttpServer()).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('process_cpu_seconds_total');
  });
});
