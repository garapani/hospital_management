import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app/app.module.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { signTestToken } from '../testing/test-jwt.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// End-to-end proof that PatientAuthGuard and the JWT accountType/patientId claims (wired in
// auth-context.middleware.ts and auth.service.ts) actually gate /patient-portal/* through the
// real AppModule route table — not just at the unit-guard or service-scoping level (see
// patient-auth.guard.spec.ts and patient-portal.service.integration-spec.ts respectively).
describe('PatientPortalController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let patientId: string;
  let patientToken: string;
  let staffToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patient_portal_http' });

    const patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
    );
    const patient = await ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: '00000000-0000-4000-8000-0000000000e4', correlationId: 'test' },
      () => patientsService.create({ firstName: 'Http', lastName: 'Patient', gender: 'Female' }),
    );
    patientId = patient.id;

    patientToken = await signTestToken({
      sub: '00000000-0000-4000-8000-0000000000f6',
      hospitalId: ctx.tenantId,
      accountType: 'patient',
      patientId,
    });
    staffToken = await signTestToken({
      sub: '00000000-0000-4000-8000-0000000000f7',
      hospitalId: ctx.tenantId,
      accountType: 'staff',
      roles: ['Doctor'],
      permissions: ['patients.read'],
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

  it('returns the calling patient\'s own profile for a patient-portal token', async () => {
    const response = await request(app.getHttpServer())
      .get('/patient-portal/me')
      .set('Authorization', `Bearer ${patientToken}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(patientId);
  });

  it('rejects a staff token with 403, even one holding an unrelated permission', async () => {
    const response = await request(app.getHttpServer())
      .get('/patient-portal/appointments')
      .set('Authorization', `Bearer ${staffToken}`);

    expect(response.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401 before it ever reaches the guard', async () => {
    const response = await request(app.getHttpServer()).get('/patient-portal/appointments');

    expect(response.status).toBe(401);
  });

  it('sends Cache-Control: no-store on every response, since this whole controller serves PHI', async () => {
    const routes = ['/patient-portal/me', '/patient-portal/appointments', '/patient-portal/invoices', '/patient-portal/prescriptions', '/patient-portal/results'];
    for (const route of routes) {
      const response = await request(app.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${patientToken}`);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});
