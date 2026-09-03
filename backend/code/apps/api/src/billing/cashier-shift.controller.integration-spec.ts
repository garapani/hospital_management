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

describe('CashierShiftController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let manageToken: string;
  let readToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'cashier_shift_ctrl' });

    manageToken = await signTestToken({
      sub: '00000000-0000-4000-8000-0000000000b1',
      hospitalId: ctx.tenantId,
      permissions: ['billing.manage', 'billing.read'],
    });
    readToken = await signTestToken({
      sub: '00000000-0000-4000-8000-0000000000b2',
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

  it('fails with 401/403 when opening a shift unauthenticated', async () => {
    const res = await request(app.getHttpServer())
      .post('/billing/cashier-shifts')
      .send({ floatAmount: 1000 });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when listing shifts unauthenticated', async () => {
    const res = await request(app.getHttpServer()).get('/billing/cashier-shifts');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('rejects opening/closing a shift with only billing.read (needs billing.manage)', async () => {
    const openRes = await request(app.getHttpServer())
      .post('/billing/cashier-shifts')
      .set('Authorization', `Bearer ${readToken}`)
      .send({ floatAmount: 1000 });
    expect(openRes.status).toBe(403);

    const closeRes = await request(app.getHttpServer())
      .post('/billing/cashier-shifts/00000000-0000-0000-0000-000000000000/close')
      .set('Authorization', `Bearer ${readToken}`)
      .send({ cashDenominationCounts: {} });
    expect(closeRes.status).toBe(403);
  });

  it('opens, lists, fetches, and closes a shift over HTTP end to end', async () => {
    const openRes = await request(app.getHttpServer())
      .post('/billing/cashier-shifts')
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ floatAmount: 1000, notes: 'Morning shift' });
    expect(openRes.status).toBe(201);
    expect(openRes.body.status).toBe('Open');
    const shiftId = openRes.body.id;

    const currentRes = await request(app.getHttpServer())
      .get('/billing/cashier-shifts/current')
      .set('Authorization', `Bearer ${manageToken}`);
    expect(currentRes.status).toBe(200);
    expect(currentRes.body.id).toBe(shiftId);

    const listRes = await request(app.getHttpServer())
      .get('/billing/cashier-shifts')
      .set('Authorization', `Bearer ${readToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((s: { id: string }) => s.id === shiftId)).toBe(true);

    const getRes = await request(app.getHttpServer())
      .get(`/billing/cashier-shifts/${shiftId}`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.floatAmount).toBe(1000);

    const closeRes = await request(app.getHttpServer())
      .post(`/billing/cashier-shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${manageToken}`)
      .send({ cashDenominationCounts: { '500': 2 } });
    expect(closeRes.status).toBe(201);
    expect(closeRes.body.shift.status).toBe('Closed');
    expect(closeRes.body.shift.cashDeclaredTotal).toBe(1000);

    const reconciliationRes = await request(app.getHttpServer())
      .get(`/billing/cashier-shifts/${shiftId}/reconciliation`)
      .set('Authorization', `Bearer ${readToken}`);
    expect(reconciliationRes.status).toBe(200);
    expect(reconciliationRes.body.shift.id).toBe(shiftId);
  });

  it('404s fetching an unknown shift id', async () => {
    const res = await request(app.getHttpServer())
      .get('/billing/cashier-shifts/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${readToken}`);
    expect(res.status).toBe(404);
  });
});
