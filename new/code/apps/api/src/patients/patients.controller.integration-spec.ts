import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreatePatientTables005 } from '../database/migrations/005_create_patient_tables.js';
import { PatientsModule } from './patients.module.js';

describe('PatientsController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantContext: TenantContextService;

  const tenantId = 'test_patients_ctrl';

  const fullPermHeaders = {
    'x-tenant-id': tenantId,
    'x-permissions': 'patients.create,patients.read,patients.update,patients.manage',
  };

  const readOnlyHeaders = {
    'x-tenant-id': tenantId,
    'x-permissions': 'patients.read',
  };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [PatientsModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    tenantContext = moduleRef.get(TenantContextService);
    const tenantConnection = moduleRef.get(TenantConnectionService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, tenantId);

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  describe('HTTP POST /api/patients', () => {
    it('creates a patient and assigns a generated patient number', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set(fullPermHeaders)
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

    it('rejects creation with 403 Forbidden when patients.create permission is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/patients')
        .set(readOnlyHeaders)
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
        .set(fullPermHeaders)
        .send({
          firstName: 'Jane',
          lastName: 'Smith',
          gender: 'Female',
          phoneNumber: phone,
        });
      expect(firstResponse.status).toBe(201);

      const duplicateResponse = await request(app.getHttpServer())
        .post('/api/patients')
        .set(fullPermHeaders)
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
        .set(readOnlyHeaders)
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
        .set(fullPermHeaders)
        .send({
          firstName: 'Alice',
          lastName: 'Wonderland',
          gender: 'Female',
        });
      const patientId = createRes.body.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set(readOnlyHeaders);

      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(patientId);
      expect(getRes.body.firstName).toBe('Alice');
    });

    it('returns 404 for non-existent patient id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients/00000000-0000-0000-0000-000000000000')
        .set(readOnlyHeaders);

      expect(response.status).toBe(404);
    });

    it('lists patients with search query', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/patients?q=Wonderland')
        .set(readOnlyHeaders);

      expect(response.status).toBe(200);
      expect(response.body.data).toBeDefined();
      expect(response.body.total).toBeGreaterThanOrEqual(1);
      expect(response.body.data.some((p: { lastName: string }) => p.lastName === 'Wonderland')).toBe(true);
    });
  });

  describe('HTTP PATCH /api/patients/:id', () => {
    it('updates patient details', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set(fullPermHeaders)
        .send({
          firstName: 'Bob',
          lastName: 'Marley',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/api/patients/${patientId}`)
        .set(fullPermHeaders)
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
        .set(fullPermHeaders)
        .send({
          firstName: 'Charlie',
          lastName: 'Brown',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`)
        .set(fullPermHeaders);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toEqual({ success: true });

      const getRes = await request(app.getHttpServer())
        .get(`/api/patients/${patientId}`)
        .set(readOnlyHeaders);

      expect(getRes.status).toBe(404);
    });

    it('rejects deactivation with 403 Forbidden without patients.manage permission', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/api/patients')
        .set(fullPermHeaders)
        .send({
          firstName: 'David',
          lastName: 'Miller',
          gender: 'Male',
        });
      const patientId = createRes.body.id;

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/patients/${patientId}`)
        .set(readOnlyHeaders);

      expect(deleteRes.status).toBe(403);
    });
  });
});
