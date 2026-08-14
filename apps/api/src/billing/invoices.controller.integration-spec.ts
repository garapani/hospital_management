import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InvoicesController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'invoices_ctrl' });

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

  it('fails with 401/403 when creating an invoice', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/invoices')
      .send({
        patientId: '00000000-0000-0000-0000-000000000000',
        createdBy: '00000000-0000-0000-0000-000000000000',
        items: [{ description: 'Consultation Fee', unitPrice: 500 }],
      });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when listing invoices', async () => {
    const res = await request(app.getHttpServer()).get('/billing/invoices');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when recording a payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/invoices/00000000-0000-0000-0000-000000000000/payments')
      .send({ amount: 100, paymentMode: 'Cash', receivedBy: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when issuing a return', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/invoices/00000000-0000-0000-0000-000000000000/returns')
      .send({ amount: 100, reason: 'x', returnedBy: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
