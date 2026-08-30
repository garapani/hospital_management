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

describe('AdmissionsController (e2e)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;
  const staffId = '00000000-0000-4000-8000-0000000000a1';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'admissions_ctrl' });

    token = await signTestToken({
      sub: staffId,
      hospitalId: ctx.tenantId,
      permissions: [
        'admission.read',
        'admission.manage',
        'patients.create',
        'patients.read',
        'master-data.manage',
      ],
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

  describe('discharge-summaries and admission routes', () => {
    let patientAId: string;
    let patientBId: string;
    let admissionAId: string;
    let admissionBId: string;
    let admissionCId: string;
    let summaryAId: string;
    let summaryBId: string;

    const http = {
      get: (url: string) =>
        request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${token}`),
      post: (url: string, body: unknown) =>
        request(app.getHttpServer())
          .post(url)
          .set('Authorization', `Bearer ${token}`)
          .send(body as object),
      patch: (url: string, body: unknown) =>
        request(app.getHttpServer())
          .patch(url)
          .set('Authorization', `Bearer ${token}`)
          .send(body as object),
    };

    beforeAll(async () => {
      // Create test patients
      const patientARes = await http.post('/patients', {
        firstName: 'Patient',
        lastName: 'A',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber: '9900000001',
      });
      patientAId = patientARes.body.id;

      const patientBRes = await http.post('/patients', {
        firstName: 'Patient',
        lastName: 'B',
        dateOfBirth: '1992-02-02',
        gender: 'Female',
        phoneNumber: '9900000002',
      });
      patientBId = patientBRes.body.id;

      // Create ward and beds
      const wardRes = await http.post('/wards', {
        wardCode: 'W-CTRL',
        wardName: 'Ward Controller',
      });
      const wardId = wardRes.body.id;

      const bedARes = await http.post(`/wards/${wardId}/beds`, {
        bedNumber: 'C101',
      });
      const bedBRes = await http.post(`/wards/${wardId}/beds`, {
        bedNumber: 'C102',
      });
      const bedCRes = await http.post(`/wards/${wardId}/beds`, {
        bedNumber: 'C103',
      });

      // Create admission A, discharge it, and create discharge summary
      const admissionARes = await http.post('/admissions', {
        patientId: patientAId,
        admissionSource: 'Direct',
        admittingDoctorId: staffId,
        bedId: bedARes.body.id,
      });
      admissionAId = admissionARes.body.id;

      await http.patch(`/admissions/${admissionAId}/discharge`, {
        dischargedBy: staffId,
      });

      const summaryARes = await http.post('/admissions/discharge-summaries', {
        admissionId: admissionAId,
        patientId: patientAId,
        primaryDiagnosis: 'Diagnosis A',
        preparedBy: staffId,
      });
      summaryAId = summaryARes.body.id;

      // Create admission B, discharge it, and create discharge summary
      const admissionBRes = await http.post('/admissions', {
        patientId: patientBId,
        admissionSource: 'Direct',
        admittingDoctorId: staffId,
        bedId: bedBRes.body.id,
      });
      admissionBId = admissionBRes.body.id;

      await http.patch(`/admissions/${admissionBId}/discharge`, {
        dischargedBy: staffId,
      });

      const summaryBRes = await http.post('/admissions/discharge-summaries', {
        admissionId: admissionBId,
        patientId: patientBId,
        primaryDiagnosis: 'Diagnosis B',
        preparedBy: staffId,
      });
      summaryBId = summaryBRes.body.id;

      // Create active admission C (for testing GET /admissions/:id)
      const admissionCRes = await http.post('/admissions', {
        patientId: patientAId,
        admissionSource: 'Direct',
        admittingDoctorId: staffId,
        bedId: bedCRes.body.id,
      });
      admissionCId = admissionCRes.body.id;
    });

    it('lists discharge summaries and returns 200 with an array', async () => {
      const res = await http.get('/admissions/discharge-summaries');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      const ids = res.body.map((s: { id: string }) => s.id);
      expect(ids).toContain(summaryAId);
      expect(ids).toContain(summaryBId);
    });

    it('filters discharge summaries with ?patientId=<uuid>', async () => {
      const res = await http.get(`/admissions/discharge-summaries?patientId=${patientAId}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(summaryAId);
      expect(res.body[0].patientId).toBe(patientAId);
    });

    it('resolves a real admission via GET /admissions/:id', async () => {
      const res = await http.get(`/admissions/${admissionCId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(admissionCId);
      expect(res.body.patientId).toBe(patientAId);
      expect(res.body.status).toBe('Admitted');
    });
  });
});
