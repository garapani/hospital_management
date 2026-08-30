import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { PatientsModule } from './patients.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('PatientsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;

  let fullPermToken: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patients_ctrl', seedRbac: true });

    fullPermToken = await signTestToken({
      sub: 'patients-controller-full',
      hospitalId: ctx.tenantId,
      permissions: ['patients.create', 'patients.read', 'patients.update', 'patients.manage'],
    });

    readOnlyToken = await signTestToken({
      sub: 'patients-controller-readonly',
      hospitalId: ctx.tenantId,
      permissions: ['patients.read'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [PatientsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
    app.setGlobalPrefix('api');
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  describe('HTTP POST /api/patients', () => {
    it('creates a patient and assigns a generated patient number', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          gender: 'Male',
          phoneNumber: '9876543210',
          dateOfBirth: '1990-05-15',
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.patientNo).toMatch(/^PAT-\d{4}-\d{5}$/);
      expect(response.body.firstName).toBe('John');
      expect(response.body.lastName).toBe('Doe');
      expect(response.body.isActive).toBe(true);
    });

    it('rejects creation with 400 when firstName/lastName are empty strings', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: '',
          lastName: '',
          gender: 'Male',
        });

      expect(response.status).toBe(400);
    });

    it('rejects creation with 400 for an invalid email format', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'Email',
          gender: 'Male',
          email: 'not-an-email',
        });

      expect(response.status).toBe(400);
    });

    it('rejects creation with 400 for a non-10-digit phone number', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'Phone',
          gender: 'Male',
          phoneNumber: '12345',
        });

      expect(response.status).toBe(400);
    });

    it('rejects creation with 400 for an out-of-range gender or bloodGroup value', async () => {
      const badGender = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'Gender',
          gender: 'Alien',
        });
      expect(badGender.status).toBe(400);

      const badBloodGroup = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Bad',
          lastName: 'BloodGroup',
          gender: 'Male',
          bloodGroup: 'Z+',
        });
      expect(badBloodGroup.status).toBe(400);
    });

    it('rejects creation with 403 Forbidden when patients.create permission is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          firstName: 'Unauthorized',
          lastName: 'User',
          gender: 'Female',
        });

      expect(response.status).toBe(403);
    });

    it('returns 409 Conflict on duplicate patient creation when allowDuplicate is not true', async () => {
      const phone = '9998887776';

      const firstResponse = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Smith',
          gender: 'Female',
          phoneNumber: phone,
        });
      expect(firstResponse.status).toBe(201);

      const duplicateResponse = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Jane',
          lastName: 'Smith',
          gender: 'Female',
          phoneNumber: phone,
        });

      expect(duplicateResponse.status).toBe(409);
      expect(duplicateResponse.body.duplicates).toBeDefined();
      expect(duplicateResponse.body.duplicates.length).toBeGreaterThan(0);
    });
  });

  describe('HTTP POST /api/patients/check-duplicates', () => {
    it('returns matching patients for potential duplicate check', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients/check-duplicates')
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .send({
          phoneNumber: '9998887776',
        });

      expect(response.status).toBe(201);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.some((p: { phoneNumber: string }) => p.phoneNumber === '9998887776')).toBe(true);
    });
  });

  describe('HTTP GET /api/patients and GET /api/patients/:id', () => {
    it('retrieves patient by id', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Alice',
          lastName: 'Wonderland',
          gender: 'Female',
        });
      const patientId = createRes.body.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(patientId);
      expect(getRes.body.firstName).toBe('Alice');
    });

    it('returns 404 for non-existent patient id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(response.status).toBe(404);
    });

    it('lists patients with search query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?q=Wonderland')
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(response.body.data.some((p: { lastName: string }) => p.lastName === 'Wonderland')).toBe(true);
    });
  });

  describe('HTTP PATCH /api/patients/:id', () => {
    it('updates patient details', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Bob',
          lastName: 'Marley',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          email: 'bob.marley@example.com',
          bloodGroup: 'O+',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.email).toBe('bob.marley@example.com');
      expect(patchRes.body.bloodGroup).toBe('O+');
    });
  });

  describe('HTTP DELETE /api/patients/:id', () => {
    it('deactivates patient and makes subsequent GET return 404', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'Charlie',
          lastName: 'Brown',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${fullPermToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({ success: true });

      const getRes = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(getRes.status).toBe(404);
    });

    it('rejects deactivation with 403 Forbidden without patients.manage permission', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set('Authorization', `Bearer ${fullPermToken}`)
        .send({
          firstName: 'David',
          lastName: 'Miller',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(deleteRes.status).toBe(403);
    });
  });
});
