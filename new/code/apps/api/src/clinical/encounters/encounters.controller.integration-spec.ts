import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app/app.module.js';
import { createDataSource } from '../../database/data-source.js';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { AccountsService } from '../../accounts/accounts.service.js';
import { PermissionGuard } from '@hospital/auth-guards';
import { TenantContextService } from '@hospital/tenant-context';

describe('EncountersController (integration)', () => {
  let app: INestApplication;
  const dataSource = createDataSource();
  const tenantConnectionService = new TenantConnectionService(dataSource, new TenantContextService());
  const accountsService = new AccountsService(tenantConnectionService, dataSource);
  const tenantId = 'test_encounters_ctrl';
  const patientId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, tenantId);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(PermissionGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            accountId: 'test-account',
            tenantId,
            permissions: req.headers['x-test-permissions']?.split(',') || [],
          };
          
          const permissions = req.user.permissions;
          const routePermission = Reflect.getMetadata('requiredPermission', context.getHandler());
          if (routePermission && !permissions.includes(routePermission)) {
            return false;
          }
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  describe('Authorization', () => {
    it('returns 403 when creating a note without encounter.manage', async () => {
      await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.read')
        .send({ patientId, doctorId: '00000000-0000-0000-0000-000000000002' })
        .expect(403);
    });

    it('returns 403 when reading notes without encounter.read', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.manage')
        .expect(403);
    });

    it('allows access with correct permissions', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.read')
        .expect(200);
    });
  });

  describe('CRUD Endpoints', () => {
    let noteId: string;

    it('creates a note', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.manage')
        .send({
          patientId,
          doctorId: '00000000-0000-0000-0000-000000000002',
          chiefComplaint: 'Fever',
        })
        .expect(201);
      
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('Draft');
      noteId = res.body.id;
    });

    it('updates a note', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/encounters/notes/${noteId}`)
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.manage')
        .send({
          plan: 'Take paracetamol',
        })
        .expect(200);
      
      expect(res.body.plan).toBe('Take paracetamol');
    });

    it('creates a diagnosis', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/diagnoses')
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.manage')
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
        .set('x-tenant-id', tenantId)
        .set('x-test-permissions', 'encounter.manage')
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
