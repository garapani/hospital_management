import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

describe('InvoicesController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let manageToken: string;
  let readToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'invoices_ctrl' });

    manageToken = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000a1',
      hospitalId: ctx.tenantId,
      permissions: ['billing.manage', 'patients.create'],
    });
    readToken = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000a2',
      hospitalId: ctx.tenantId,
      permissions: ['billing.read'],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
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

  async function makePatientId(phoneNumber: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ firstName: 'Test', lastName: 'Patient', dateOfBirth: '1990-01-01', gender: 'Male', phoneNumber })
      .expect(201);
    return res.body.id;
  }

  // Regression tests for code-review-findings-2026-08-25.md's billing P2: taxPercent/discountAmount
  // were unbounded/unsigned on CreateInvoiceItemDto.
  it('rejects an invoice item with a negative discountAmount', async () => {
    const patientId = await makePatientId('5559990001');
    await request(app.getHttpServer())
      .post('/billing/invoices')
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ patientId, items: [{ description: 'Consultation', unitPrice: 500, discountAmount: -1 }] })
      .expect(400);
  });

  it('rejects an invoice item with a taxPercent over 100', async () => {
    const patientId = await makePatientId('5559990002');
    await request(app.getHttpServer())
      .post('/billing/invoices')
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ patientId, items: [{ description: 'Consultation', unitPrice: 500, taxPercent: 101 }] })
      .expect(400);
  });

  it('rejects an invoice item with a negative taxPercent', async () => {
    const patientId = await makePatientId('5559990003');
    await request(app.getHttpServer())
      .post('/billing/invoices')
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ patientId, items: [{ description: 'Consultation', unitPrice: 500, taxPercent: -5 }] })
      .expect(400);
  });

  // Regression tests for code-review-findings-2026-08-25.md's billing P2: only one permission
  // (billing.manage) gated both reads and writes.
  describe('billing.read / billing.manage split', () => {
    it('allows a billing.read-only caller to list and read invoices', async () => {
      await request(app.getHttpServer())
        .get('/billing/invoices')
        .set('Authorization', `Bearer ${readToken}`)
        .expect(200);
    });

    it('rejects a billing.read-only caller creating an invoice', async () => {
      const patientId = await makePatientId('5559990004');
      await request(app.getHttpServer())
        .post('/billing/invoices')
        .set('Authorization', `Bearer ${readToken}`)
        .send({ patientId, items: [{ description: 'Consultation', unitPrice: 500 }] })
        .expect(403);
    });

    it('rejects a billing.manage-only caller (no billing.read) listing invoices', async () => {
      const manageOnlyToken = await signTestToken({
        sub: '00000000-0000-0000-0000-0000000000a3',
        hospitalId: ctx.tenantId,
        permissions: ['billing.manage'],
      });
      await request(app.getHttpServer())
        .get('/billing/invoices')
        .set('Authorization', `Bearer ${manageOnlyToken}`)
        .expect(403);
    });
  });
});
