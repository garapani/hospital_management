import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import { Patient } from '../patients/entities/patient.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

describe('AppointmentsController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'appointments_ctrl' });
    token = await signTestToken({
      sub: 'appointments-spec-user',
      hospitalId: ctx.tenantId,
      permissions: ['appointment.manage', 'appointment.read'],
    });

    const patient = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Patient).save(
          manager.getRepository(Patient).create({
            patientNo: `APPT-CTRL-${Date.now()}`,
            firstName: 'Fixture',
            lastName: 'Patient',
            gender: 'Female',
          }),
        ),
      ),
    );
    patientId = patient.id;

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

  it('fails with 400 when creating with incomplete payload (missing required fields)', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        patientId: '11111111-1111-1111-1111-111111111111',
        reason: 'General checkup',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toBeDefined();
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('creates an appointment with a complete valid payload', async () => {
    const validPayload = {
      patientId,
      firstName: 'Jane',
      lastName: 'Doe',
      contactNumber: '9876543210',
      appointmentDate: '2026-08-15',
      appointmentTime: '14:00',
      appointmentType: 'Follow-up',
      reason: 'Routine visit',
    };

    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send(validPayload);

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect(res.body.firstName).toBe('Jane');
    expect(res.body.lastName).toBe('Doe');
    expect(res.body.contactNumber).toBe('9876543210');
    expect(res.body.appointmentDate).toBe('2026-08-15');
    expect(res.body.appointmentTime).toContain('14:00');
    expect(res.body.appointmentType).toBe('Follow-up');
    expect(res.body.reason).toBe('Routine visit');
    expect(res.body.patientId).toBe(patientId);
  });

  it('fails with 400 when creating with empty required string fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: '',
        lastName: 'Doe',
        contactNumber: '1234567890',
        appointmentDate: '2026-08-15',
        appointmentTime: '14:00',
        appointmentType: 'Consultation',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('firstName should not be empty')])
    );
  });

  it('fails with 400 when creating with invalid UUID in optional fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: 'Jane',
        lastName: 'Doe',
        contactNumber: '9876543210',
        appointmentDate: '2026-08-15',
        appointmentTime: '14:00',
        appointmentType: 'Follow-up',
        doctorId: 'not-a-uuid',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('doctorId must be a UUID')])
    );
  });

  it('updates an appointment successfully with a valid payload', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: 'Bob',
        lastName: 'Builder',
        contactNumber: '5550001111',
        appointmentDate: '2026-08-18',
        appointmentTime: '10:00',
        appointmentType: 'Checkup',
      });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const appointmentId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .put(`/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        reason: 'Patient was seen and treated',
      });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.id).toBe(appointmentId);
    expect(res.body.reason).toBe('Patient was seen and treated');
  });

  it('does not let status be set through the update endpoint', async () => {
    // status is not part of UpdateAppointmentDto: a client-supplied status is silently
    // stripped by the whitelist ValidationPipe, not applied. Cancellation is the only
    // sanctioned status transition, via POST /appointments/:id/cancel.
    const createRes = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: 'Dana',
        lastName: 'Scully',
        contactNumber: '5554445555',
        appointmentDate: '2026-08-19',
        appointmentTime: '13:00',
        appointmentType: 'Checkup',
      });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const appointmentId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .put(`/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ status: 'Completed' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.status).toBe('Scheduled');
  });

  it('fails with 400 when updating with invalid UUID', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: 'Alice',
        lastName: 'Smith',
        contactNumber: '5551234567',
        appointmentDate: '2026-08-16',
        appointmentTime: '09:00',
        appointmentType: 'Consultation',
      });
    expect(createRes.status).toBe(HttpStatus.CREATED);
    const appointmentId = createRes.body.id;

    const res = await request(app.getHttpServer())
      .put(`/appointments/${appointmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        doctorId: 'not-a-valid-uuid',
      });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('doctorId must be a UUID')])
    );
  });

  it('strips non-whitelisted fields without failing validation', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        firstName: 'Charlie',
        lastName: 'Brown',
        contactNumber: '5552223333',
        appointmentDate: '2026-08-20',
        appointmentTime: '11:00',
        appointmentType: 'Consultation',
        extraFieldThatShouldBeStripped: 'malicious-or-unexpected-value',
      });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.id).toBeDefined();
    expect((res.body as Record<string, unknown>).extraFieldThatShouldBeStripped).toBeUndefined();
  });
});
