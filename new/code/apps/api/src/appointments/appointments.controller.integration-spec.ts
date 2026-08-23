import { createApiValidationPipe } from '../app/api-validation-pipe.js';
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
    app.useGlobalPipes(createApiValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('fails with 401 when creating without an Authorization header', async () => {
    // No Authorization header is sent, so AuthContextMiddleware rejects the request
    // before it ever reaches PermissionGuard — this is always 401, never 403.
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

    expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
