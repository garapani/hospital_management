import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { AccountsModule } from './accounts.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let adminHeaders: Record<string, string>;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounts_controller', seedRbac: true });
    adminHeaders = {
      'x-tenant-id': ctx.tenantId,
      'x-permissions': 'identity.accounts.manage',
    };

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('creates a staff account with needsPasswordUpdate set, and never returns passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.create.user',
        email: 'ctrlcreate@example.com',
        displayName: 'Ctrl Create User',
        password: 'a-temp-password',
        roleName: 'Nurse',
      });

    expect(response.status).toBe(201);
    expect(response.body.username).toBe('ctrl.create.user');
    expect(response.body.needsPasswordUpdate).toBe(true);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('lists accounts in the tenant', async () => {
    const response = await request(app.getHttpServer()).get('/accounts').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(response.body.some((a: { username: string }) => a.username === 'ctrl.create.user')).toBe(true);
  });

  it('gets, deactivates, reactivates, and unlocks a single account', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.lifecycle.user',
        email: 'ctrllifecycle@example.com',
        displayName: 'Ctrl Lifecycle User',
        password: 'a-lifecycle-password',
        roleName: 'Doctor',
      });
    const accountId = createResponse.body.id;

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set(adminHeaders);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.roleNames).toEqual(['Doctor']);

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/deactivate`)
      .set(adminHeaders);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.isActive).toBe(false);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/reactivate`)
      .set(adminHeaders);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.isActive).toBe(true);

    const unlockResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/unlock`)
      .set(adminHeaders);
    expect(unlockResponse.status).toBe(200);
    expect(unlockResponse.body.failedLoginAttempts).toBe(0);
  });

  it('returns 404 for an unknown account id', async () => {
    const response = await request(app.getHttpServer())
      .patch('/accounts/00000000-0000-0000-0000-000000000000/deactivate')
      .set(adminHeaders);
    expect(response.status).toBe(404);
  });

  it('returns 404 when assigning a role to an unknown account id', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts/00000000-0000-0000-0000-000000000000/roles')
      .set(adminHeaders)
      .send({ roleName: 'Doctor' });
    expect(response.status).toBe(404);
  });

  it('assigns and revokes a role assignment', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.roles.user',
        email: 'ctrlroles@example.com',
        displayName: 'Ctrl Roles User',
        password: 'a-roles-password',
        roleName: 'Nurse',
      });
    const accountId = createResponse.body.id;

    const assignResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(adminHeaders)
      .send({ roleName: 'Doctor' });
    expect(assignResponse.status).toBe(201);
    const accountRoleId = assignResponse.body.id;

    const duplicateResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(adminHeaders)
      .send({ roleName: 'Doctor' });
    expect(duplicateResponse.status).toBe(409);

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/accounts/${accountId}/roles/${accountRoleId}`)
      .set(adminHeaders);
    expect(revokeResponse.status).toBe(200);

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set(adminHeaders);
    expect(getResponse.body.roleNames).toEqual(['Nurse']);
  });
});
