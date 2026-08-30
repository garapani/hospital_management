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

describe('BillingSettingsController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'billing_settings_ctrl' });

    token = await signTestToken({
      sub: '00000000-0000-4000-8000-0000000000a1',
      hospitalId: ctx.tenantId,
      permissions: ['master-data.manage'],
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

  it('fails with 401/403 when reading billing settings', async () => {
    const res = await request(app.getHttpServer()).get('/billing/settings');
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  it('fails with 401/403 when updating billing settings', async () => {
    const res = await request(app.getHttpServer())
      .patch('/billing/settings')
      .send({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital' });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // Regression test for code-review-findings-2026-08-25.md's billing P2: gstin/stateCode were
  // plain @IsString(), so a malformed value reached storage untouched instead of being rejected
  // by the real ValidationPipe.
  it('rejects a malformed gstin', async () => {
    await request(app.getHttpServer())
      .patch('/billing/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ gstin: 'not-a-gstin', stateCode: '27', hospitalLegalName: 'Test Hospital' })
      .expect(400);
  });

  it('rejects a malformed stateCode', async () => {
    await request(app.getHttpServer())
      .patch('/billing/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ gstin: '27AAAAA0000A1Z5', stateCode: 'MH', hospitalLegalName: 'Test Hospital' })
      .expect(400);
  });

  it('accepts a well-formed gstin and stateCode', async () => {
    const res = await request(app.getHttpServer())
      .patch('/billing/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ gstin: '27AAAAA0000A1Z5', stateCode: '27', hospitalLegalName: 'Test Hospital' })
      .expect(200);
    expect(res.body.gstin).toBe('27AAAAA0000A1Z5');
  });
});
