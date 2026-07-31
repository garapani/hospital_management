import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthModule } from './auth.module.js';

describe('Cross-tenant login isolation (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    const accountsService = new AccountsService(tenantConnection, dataSource);

    for (const tenantId of ['test_xtenant_a', 'test_xtenant_b']) {
      await accountsService.provisionTenantSchema(dataSource, tenantId);
    }

    await tenantContext.run({ tenantId: 'test_xtenant_a', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'a@example.com',
        displayName: 'Tenant A User',
        password: 'tenant-a-password',
        roleName: 'Doctor',
      }),
    );
    await tenantContext.run({ tenantId: 'test_xtenant_b', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'shared.username',
        email: 'b@example.com',
        displayName: 'Tenant B User',
        password: 'tenant-b-password',
        roleName: 'Nurse',
      }),
    );

    const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .overrideProvider(TenantContextService)
      .useValue(tenantContext)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_xtenant_a" CASCADE`);
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_xtenant_b" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('the same username in two tenants authenticates independently with different passwords', async () => {
    const resA = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_a')
      .send({ username: 'shared.username', password: 'tenant-a-password' });
    expect(resA.status).toBe(200);

    const resB = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_b')
      .send({ username: 'shared.username', password: 'tenant-b-password' });
    expect(resB.status).toBe(200);
  });

  it("tenant A's password never authenticates against tenant B's account of the same username", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_b')
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    expect(response.status).toBe(401);
  });

  it("a JWT's hospitalId claim reflects only the tenant it was issued under", async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_xtenant_a')
      .send({ username: 'shared.username', password: 'tenant-a-password' });

    const payload = JSON.parse(
      Buffer.from(response.body.accessToken.split('.')[1], 'base64url').toString('utf8'),
    );
    expect(payload.hospitalId).toBe('test_xtenant_a');
    expect(payload.roles).toEqual(['Doctor']);
  });
});
