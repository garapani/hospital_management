import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AppointmentsController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'appointments_ctrl' });

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

  it('fails with 403 when creating without proper permissions', async () => {
    // Missing correlation logic/auth headers since we do not inject a valid JWT in this simple E2E,
    // it should fail at the AuthGuard layer or return 401/403.
    // In our app, we expect 401 Unauthorized or 403 Forbidden.
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({
        firstName: 'John',
        lastName: 'Doe',
        contactNumber: '1234567890',
        appointmentDate: '2026-08-01',
        appointmentTime: '10:00',
        appointmentType: 'Consultation',
      });

    expect([HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN]).toContain(res.status);
  });
});
