import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AdmissionsController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'admissions_ctrl' });

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

  it('fails with 401 when admitting without an Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .post('/admissions')
      .send({
        patientId: '00000000-0000-0000-0000-000000000000',
        admissionSource: 'Direct',
        admittingDoctorId: '00000000-0000-0000-0000-000000000000',
        bedId: '00000000-0000-0000-0000-000000000000',
      });

    // No Authorization header is sent, so AuthContextMiddleware rejects the request
    // before it ever reaches PermissionGuard — this is always 401, never 403.
    expect(res.status).toBe(401);
  });

  it('fails with 401 when listing admissions without an Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/admissions');

    expect(res.status).toBe(401);
  });
});
