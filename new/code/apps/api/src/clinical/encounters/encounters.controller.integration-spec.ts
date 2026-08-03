import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../app/app.module.js';
import { PermissionGuard } from '@hospital/auth-guards';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../../testing/tenant-test-context.js';

describe('EncountersController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  const patientId = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'encounters_ctrl' });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(PermissionGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = {
            accountId: 'test-account',
            tenantId: ctx.tenantId,
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
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  describe('Authorization', () => {
    it('returns 403 when creating a note without encounter.manage', async () => {
      await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('x-tenant-id', ctx.tenantId)
        .set('x-test-permissions', 'encounter.read')
        .send({ patientId, doctorId: '00000000-0000-0000-0000-000000000002' })
        .expect(403);
    });

    it('returns 403 when reading notes without encounter.read', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('x-tenant-id', ctx.tenantId)
        .set('x-test-permissions', 'encounter.manage')
        .expect(403);
    });

    it('allows access with correct permissions', async () => {
      await request(app.getHttpServer())
        .get(`/encounters/notes/patient/${patientId}`)
        .set('x-tenant-id', ctx.tenantId)
        .set('x-test-permissions', 'encounter.read')
        .expect(200);
    });
  });

  describe('CRUD Endpoints', () => {
    let noteId: string;

    it('creates a note', async () => {
      const res = await request(app.getHttpServer())
        .post('/encounters/notes')
        .set('x-tenant-id', ctx.tenantId)
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
        .set('x-tenant-id', ctx.tenantId)
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
        .set('x-tenant-id', ctx.tenantId)
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
        .set('x-tenant-id', ctx.tenantId)
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
