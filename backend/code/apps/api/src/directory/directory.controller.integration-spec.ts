import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { DirectoryModule } from './directory.module.js';
import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { PdfService } from '@hospital/pdf';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('DirectoryController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'directory_controller' });
    // No permissions granted at all — POST /directory/resolve has no @RequirePermission, so plain
    // authentication is expected to be enough.
    token = await signTestToken({ sub: 'directory-controller-user', hospitalId: ctx.tenantId });

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    const patientsService = new PatientsService(ctx.tenantConnection, patientSequence, ctx.accountsService, new PdfService());
    const patient = await ctx.inTenant(() =>
      patientsService.create({ firstName: 'Ctrl', lastName: 'Test', gender: 'Male', phoneNumber: '9990000099' }),
    );
    patientId = patient.id;

    const moduleRef = await Test.createTestingModule({ imports: [DirectoryModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(createApiValidationPipe());
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

  it('resolves ids with no specific permission required, just authentication', async () => {
    const response = await request(app.getHttpServer())
      .post('/directory/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientIds: [patientId] });

    expect(response.status).toBe(200);
    expect(response.body.patients[patientId]).toEqual({ displayName: 'Ctrl Test', patientNo: expect.any(String) });
  });

  it('rejects a non-uuid id with 400, not a raw 500', async () => {
    const response = await request(app.getHttpServer())
      .post('/directory/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({ patientIds: ['not-a-uuid'] });

    expect(response.status).toBe(400);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const response = await request(app.getHttpServer())
      .post('/directory/resolve')
      .send({ patientIds: [patientId] });

    expect(response.status).toBe(401);
  });
});
