import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Like } from 'typeorm';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RbacModule } from './rbac.module.js';
import { Role } from './entities/role.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

// Role names live in the shared platform `roles` table — prefix and clean up like the
// role-management service spec, so a successful create here can never skew the catalog counts
// another spec asserts (seed-rbac-catalog asserts exactly 14 roles).
const PREFIX = 'role_mgmt_perm_gate__';

describe('RoleManagementController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let noPermissionToken: string;
  let masterDataOnlyToken: string;
  let rbacToken: string;

  const cleanup = () => ctx.dataSource.getRepository(Role).delete({ name: Like(`${PREFIX}%`) });

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'role_mgmt_permgate', seedRbac: true });
    await cleanup();
    noPermissionToken = await signTestToken({
      sub: 'role-mgmt-permgate-user',
      hospitalId: ctx.tenantId,
    });
    // A hospital admin's worst case: they hold master-data.manage (always-on for customers),
    // which used to gate the role endpoints — it must no longer.
    masterDataOnlyToken = await signTestToken({
      sub: 'role-mgmt-permgate-hospital-admin',
      hospitalId: ctx.tenantId,
      permissions: ['master-data.manage'],
    });
    // The platform-only permission that now gates the catalog.
    rbacToken = await signTestToken({
      sub: 'role-mgmt-permgate-super-admin',
      hospitalId: ctx.tenantId,
      permissions: ['rbac.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [RbacModule] })
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

  it('rejects listing roles with 403 when no rbac.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects creating a role with 403 when no rbac.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({ name: 'Blocked Role', description: 'Blocked', priority: 1 });
    expect(response.status).toBe(403);
  });

  it('rejects a hospital admin holding master-data.manage — role catalog is platform-only', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${masterDataOnlyToken}`);
    expect(listResponse.status).toBe(403);

    const createResponse = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${masterDataOnlyToken}`)
      .send({ name: 'Hospital Created Role', description: 'Must not exist', priority: 1 });
    expect(createResponse.status).toBe(403);
  });

  it('allows listing and creating roles with rbac.manage (Super Admin)', async () => {
    const listResponse = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${rbacToken}`);
    expect(listResponse.status).toBe(200);

    const createResponse = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${rbacToken}`)
      .send({ name: `${PREFIX}Super Role`, description: 'Platform-only', priority: 2 });
    expect(createResponse.status).toBe(201);
  });
});
