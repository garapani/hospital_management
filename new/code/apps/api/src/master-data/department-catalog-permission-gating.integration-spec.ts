import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Like } from 'typeorm';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { MasterDataModule } from './master-data.module.js';
import { DepartmentCatalog } from './entities/department-catalog.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

// Shared platform table — prefix + clean up like the service spec.
const PREFIX = 'DCPERMGATE-';

describe('DepartmentCatalogController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let noPermissionToken: string;
  let masterDataOnlyToken: string;
  let rbacToken: string;

  const cleanup = () =>
    ctx.dataSource
      .getRepository(DepartmentCatalog)
      .delete({ departmentCode: Like(`${PREFIX}%`) });

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'dept_catalog_permgate', seedRbac: true });
    await cleanup();
    noPermissionToken = await signTestToken({
      sub: 'dept-catalog-permgate-user',
      hospitalId: ctx.tenantId,
    });
    // A hospital admin's worst case: master-data.manage used to gate the catalog — it must no
    // longer (the catalog is platform-only, like the role catalog).
    masterDataOnlyToken = await signTestToken({
      sub: 'dept-catalog-permgate-hospital-admin',
      hospitalId: ctx.tenantId,
      permissions: ['master-data.manage'],
    });
    rbacToken = await signTestToken({
      sub: 'dept-catalog-permgate-super-admin',
      hospitalId: ctx.tenantId,
      permissions: ['rbac.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [MasterDataModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);

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
    await cleanup();
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('rejects listing catalog departments with 403 when no rbac.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get('/catalogs/departments')
      .set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects creating a catalog department with 403 when no rbac.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/catalogs/departments')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({
        departmentCode: `${PREFIX}BLOCKED`,
        departmentName: 'Blocked Catalog Department',
        description: null,
        isAppointmentApplicable: false,
      });
    expect(response.status).toBe(403);
  });

  it('rejects a hospital admin holding master-data.manage — catalog is platform-only', async () => {
    const response = await request(app.getHttpServer())
      .get('/catalogs/departments')
      .set('Authorization', `Bearer ${masterDataOnlyToken}`);
    expect(response.status).toBe(403);
  });

  it('allows create, update, deactivate, and reactivate with rbac.manage (Super Admin)', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/catalogs/departments')
      .set('Authorization', `Bearer ${rbacToken}`)
      .send({
        departmentCode: `${PREFIX}SUPER`,
        departmentName: 'Super Catalog Department',
        description: null,
        isAppointmentApplicable: true,
      });
    expect(createResponse.status).toBe(201);
    const catalogId = createResponse.body.id;

    const updateResponse = await request(app.getHttpServer())
      .patch(`/catalogs/departments/${catalogId}`)
      .set('Authorization', `Bearer ${rbacToken}`)
      .send({ departmentName: 'Super Catalog Department (edited)' });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.departmentName).toBe('Super Catalog Department (edited)');

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/catalogs/departments/${catalogId}/deactivate`)
      .set('Authorization', `Bearer ${rbacToken}`);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.isActive).toBe(false);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/catalogs/departments/${catalogId}/reactivate`)
      .set('Authorization', `Bearer ${rbacToken}`);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.isActive).toBe(true);
  });
});
