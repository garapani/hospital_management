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

// Boots the real AppModule the same way app-module-auth-wiring.integration-spec.ts does. This is
// the one place proving AuditColumnsSubscriber (audit-columns.subscriber.ts) actually fires end to
// end: every other integration spec in this codebase either bypasses Nest's module system entirely
// (`new SomeService(...)` directly against ctx.dataSource, which never gets
// AuditColumnsWiringService's onModuleInit() registration) or doesn't touch an AuditableEntity at
// all, so createdBy/updatedBy/deletedBy would silently stay unpopulated in every other spec without
// anyone noticing — see 2026-08-22-entity-audit-columns-design.md.
describe('AuditColumnsSubscriber (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'audit_columns' });
    token = await signTestToken({
      sub: '00000000-0000-0000-0000-0000000000ac',
      hospitalId: ctx.tenantId,
      permissions: [
        'master-data.manage',
        'patients.create',
        'patients.manage',
        'encounter.manage',
        'encounter.read',
      ],
    });

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

  it('populates createdBy/updatedBy on insert, and updatedBy again on a real update', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ departmentCode: 'AUD1', departmentName: 'Audit Columns Test Dept' });
    expect(created.status).toBe(201);
    expect(created.body.createdBy).toBe('00000000-0000-0000-0000-0000000000ac');
    expect(created.body.updatedBy).toBe('00000000-0000-0000-0000-0000000000ac');

    // MasterDataService.deactivateDepartment() goes through load-then-save (the correct pattern),
    // exercising the subscriber's beforeUpdate hook.
    const deactivated = await request(app.getHttpServer())
      .patch(`/departments/${created.body.id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.updatedBy).toBe('00000000-0000-0000-0000-0000000000ac');
  });

  it('regression: PatientsService.deactivate() now populates updatedBy (previously bypassed the subscriber via a raw manager.update() call)', async () => {
    const created = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ firstName: 'Audit', lastName: 'ColumnsTest', gender: 'Female', phoneNumber: '9000000001' });
    expect(created.status).toBe(201);

    await request(app.getHttpServer())
      .delete(`/patients/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);

    // deactivate() returns void, so read the row back directly to confirm updatedBy was set —
    // a raw `manager.update()` call would leave it null despite updatedAt still bumping (TypeORM
    // handles @UpdateDateColumn in its own SQL generation, independent of subscribers).
    // runInTenantSchema, not a bare dataSource.query(): the latter has no tenant search_path set.
    // Wrapped in ctx.inTenant(): runInTenantSchema reads the tenant schema name from
    // TenantContextService's AsyncLocalStorage, which nothing sets outside of a real HTTP request
    // (the two calls above) or this explicit wrapper.
    const row = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const [result] = await manager.query(`SELECT "updatedBy" FROM patients WHERE id = $1`, [
          created.body.id,
        ]);
        return result;
      }),
    );
    expect(row.updatedBy).toBe('00000000-0000-0000-0000-0000000000ac');
  });

  it('soft-delete populates deletedAt/deletedBy and excludes the row from normal reads', async () => {
    const patient = await request(app.getHttpServer())
      .post('/patients')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({ firstName: 'Rx', lastName: 'AuditTest', gender: 'Male', phoneNumber: '9000000002' });
    expect(patient.status).toBe(201);

    const prescription = await request(app.getHttpServer())
      .post('/encounters/prescriptions')
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId)
      .send({
        patientId: patient.body.id,
        doctorId: '00000000-0000-0000-0000-000000000001',
        medicationName: 'Test Med',
        dosage: '1 tablet',
        frequency: 'Once daily',
        route: 'Oral',
        durationDays: 5,
      });
    expect(prescription.status).toBe(201);

    const deleted = await request(app.getHttpServer())
      .delete(`/encounters/prescriptions/${prescription.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);
    expect(deleted.status).toBe(200);

    const list = await request(app.getHttpServer())
      .get(`/encounters/prescriptions/patient/${patient.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-tenant-id', ctx.tenantId);
    expect(list.status).toBe(200);
    expect(list.body.data.some((p: { id: string }) => p.id === prescription.body.id)).toBe(false);

    const row = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema(async (manager) => {
        const [result] = await manager.query(
          `SELECT "deletedAt", "deletedBy" FROM prescriptions WHERE id = $1`,
          [prescription.body.id],
        );
        return result;
      }),
    );
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe('00000000-0000-0000-0000-0000000000ac');
  });
});
