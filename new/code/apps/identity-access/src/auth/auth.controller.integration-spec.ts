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

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const tenantContext = new TenantContextService();
    const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_controller');
    await tenantContext.run({ tenantId: 'test_controller', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'dr.dave',
        email: 'dave@example.com',
        displayName: 'Dr. Dave',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
    })
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
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_controller" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('returns tokens for correct credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_controller')
      .send({ username: 'dr.dave', password: 'correct-password-123' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
  });

  it('returns 401 with a generic message for wrong credentials', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', 'test_controller')
      .send({ username: 'dr.dave', password: 'wrong' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid username or password');
  });
});
