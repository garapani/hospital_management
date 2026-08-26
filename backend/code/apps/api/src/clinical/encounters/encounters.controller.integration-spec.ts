import { createApiValidationPipe } from '../../app/api-validation-pipe.js';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app/app.module.js';
import { Patient } from '../../patients/entities/patient.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';
import { signTestToken } from '../../testing/test-jwt.js';

describe('EncountersController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let patientId: string;

  let readOnlyToken: string;
  let manageOnlyToken: string;
  let fullPermToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'encounters_ctrl' });

    readOnlyToken = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000a1',
      hospitalId: ctx.tenantId,
      permissions: ['encounter.read'],
    });

    manageOnlyToken = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000a2',
      hospitalId: ctx.tenantId,
      permissions: ['encounter.manage'],
    });

    fullPermToken = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000a3',
      hospitalId: ctx.tenantId,
      permissions: ['encounter.read', 'encounter.manage'],
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    await app.init();

    const patient = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(Patient).save(
          manager.getRepository(Patient).create({
            patientNo: `ENC-CTRL-${Date.now()}`,
            firstName: 'Fixture',
            lastName: 'Patient',
            gender: 'Female',
          }),
        ),
      ),
    );
    patientId = patient.id;
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  describe('Authorization', () => {
    it('returns 403 when creating a note without encounter.manage', async () => {
      await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({ patientId, doctorId: '00000000-0000-0000-0000-000000000002' })
        .expect(403);
    });

    it('returns 403 when reading notes without encounter.read', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('Authorization', `Bearer ${manageOnlyToken}`)
        .expect(403);
    });

    it('allows access with correct permissions', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .expect(200);
    });
  });

  describe('CRUD Endpoints', () => {
    let noteId: string;

    it('creates a note', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          patientId,
          doctorId: '00000000-0000-0000-0000-000000000002',
          chiefComplaint: 'Fever',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('Draft');
      expect(res.body.doctorId).toBe('00000000-0000-0000-0000-0000000000a3');
      expect(res.body.doctorId).not.toBe('00000000-0000-0000-0000-000000000002');
      noteId = res.body.id;
    });

    it('updates a note', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/encounters/notes/${noteId}`)
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          plan: 'Take paracetamol',
        })
        .expect(200);

      expect(res.body.plan).toBe('Take paracetamol');
    });

    it('creates a diagnosis', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/diagnoses')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          patientId,
          doctorId: '00000000-0000-0000-0000-000000000002',
          description: 'Viral fever',
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
    });

    it('creates a prescription', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/prescriptions')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          patientId,
          doctorId: '00000000-0000-0000-0000-000000000002',
          medicationName: 'Paracetamol',
          dosage: '500mg',
          frequency: 'BID',
          route: 'Oral',
          durationDays: 3,
        })
        .expect(201);
      expect(res.body.id).toBeDefined();
    });
  });
});
