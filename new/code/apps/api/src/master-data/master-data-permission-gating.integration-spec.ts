import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { MasterDataModule } from './master-data.module.js';
import { MasterDataService } from './master-data.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('MasterDataController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let departmentId: string;
  let noPermissionToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'masterdata_permgate', seedRbac: true });
    noPermissionToken = await signTestToken({
      sub: 'master-data-permgate-user',
      hospitalId: ctx.tenantId,
    });

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const masterDataService = moduleRef.get(MasterDataService);

    // Do NOT replace this with ctx.inTenant(): masterDataService is resolved from the
    // MasterDataModule DI graph, which holds its own TenantContextService instance
    // (TenantContextModule is @Global()). ctx.inTenant() runs on ctx's own separate, standalone
    // TenantContextService — a different AsyncLocalStorage entirely — so the DI-resolved service
    // would see "No tenant context set". The same DI instance also backs the middleware below.
    const department = await tenantContext.run(
      { tenantId: ctx.tenantId, correlationId: 'setup' },
      () =>
        masterDataService.createDepartment({
          departmentCode: 'PERMGATE',
          departmentName: 'Permission Gate Department',
        }),
    );
    departmentId = department.id;

    app = moduleRef.createNestApplication();
    const jwtService = new JwtService({ secret: resolveJwtSecret() });
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

  it('rejects creating a department with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/departments')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({ departmentCode: 'BLOCKED', departmentName: 'Blocked Department' });
    expect(response.status).toBe(403);
  });

  it('allows listing departments for any authenticated session without master-data.manage permission', async () => {
    const response = await request(app.getHttpServer()).get('/departments').set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(200);
  });

  it('allows getting a single department for any authenticated session without master-data.manage permission', async () => {
    const response = await request(app.getHttpServer())
      .get(`/departments/${departmentId}`)
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(200);
  });

  it('rejects department deactivate/reactivate with 403 when no master-data.manage permission is granted', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/deactivate`)
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(deactivateResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/departments/${departmentId}/reactivate`)
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(reactivateResponse.status).toBe(403);
  });

  it('rejects creating a ward with 403 when no master-data.manage permission is granted', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/wards')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({ wardCode: 'BLOCKED', wardName: 'Blocked Ward' });
    expect(createResponse.status).toBe(403);
  });

  it('allows listing wards for any authenticated session without master-data.manage permission', async () => {
    const listResponse = await request(app.getHttpServer()).get('/wards').set('Authorization', `Bearer ${noPermissionToken}`);
    expect(listResponse.status).toBe(200);
  });
});
