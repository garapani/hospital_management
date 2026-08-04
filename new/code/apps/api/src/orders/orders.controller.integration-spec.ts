import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('OrdersController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'orders_ctrl' });

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

  it('fails with 401 when placing an order without an Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .send({
        patientId: '00000000-0000-0000-0000-000000000000',
        orderedBy: '00000000-0000-0000-0000-000000000000',
        items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
      });

    // No Authorization header is sent, so AuthContextMiddleware rejects the request
    // before it ever reaches PermissionGuard — this is always 401, never 403.
    expect(res.status).toBe(401);
  });

  it('fails with 401 when listing orders without an Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/orders');

    expect(res.status).toBe(401);
  });
});
