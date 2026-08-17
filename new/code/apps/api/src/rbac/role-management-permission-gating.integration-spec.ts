import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { RbacModule } from './rbac.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('RoleManagementController permission gating (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let noPermissionToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'role_mgmt_permgate', seedRbac: true });
    noPermissionToken = await signTestToken({
      sub: 'role-mgmt-permgate-user',
      hospitalId: ctx.tenantId,
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
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('rejects listing roles with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/roles').set('Authorization', `Bearer ${noPermissionToken}`);
    expect(response.status).toBe(403);
  });

  it('rejects creating a role with 403 when no master-data.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/roles')
      .set('Authorization', `Bearer ${noPermissionToken}`)
      .send({ name: 'Blocked Role', description: 'Blocked', priority: 1 });
    expect(response.status).toBe(403);
  });
});
