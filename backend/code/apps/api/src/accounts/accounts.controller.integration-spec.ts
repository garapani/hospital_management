import { createApiValidationPipe } from '../app/api-validation-pipe.js';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AccountsModule } from './accounts.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('AccountsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounts_controller', seedRbac: true });
    adminToken = await signTestToken({
      sub: 'accounts-controller-admin',
      hospitalId: ctx.tenantId,
      permissions: ['identity.accounts.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
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

  it('creates a staff account with an admin-supplied password, no forced change, never returns passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.create.user',
        email: 'ctrlcreate@example.com',
        displayName: 'Ctrl Create User',
        password: 'a-temp-password',
        roleName: 'Nurse',
      });

    expect(response.status).toBe(201);
    expect(response.body.username).toBe('ctrl.create.user');
    // Admin chose the password, so the user signs in with it directly — no forced change.
    expect(response.body.needsPasswordUpdate).toBe(false);
    expect(response.body.initialPassword).toBeUndefined();
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('generates a one-time initial password and forces a change when none is supplied', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.generated.user',
        email: 'ctrlgenerated@example.com',
        displayName: 'Ctrl Generated User',
        roleName: 'Doctor',
      });

    expect(response.status).toBe(201);
    expect(response.body.username).toBe('ctrl.generated.user');
    expect(response.body.needsPasswordUpdate).toBe(true);
    expect(typeof response.body.initialPassword).toBe('string');
    expect(response.body.initialPassword.length).toBeGreaterThanOrEqual(12);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('rejects creating a Super Admin account in a hospital tenant with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.hospital.super',
        email: 'ctrlhospitalsuper@example.com',
        displayName: 'Ctrl Hospital Super',
        roleName: 'Super Admin',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/platform-only/);
  });

  it('POST /accounts/:id/reset-password generates a one-time password and forces a change', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.reset.user',
        email: 'ctrlreset@example.com',
        displayName: 'Ctrl Reset User',
        password: 'a-reset-original-password',
        roleName: 'Nurse',
      });
    const accountId = createResponse.body.id;

    const resetResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body).toMatchObject({ success: true });
    expect(typeof resetResponse.body.initialPassword).toBe('string');
    expect(resetResponse.body.initialPassword.length).toBeGreaterThanOrEqual(12);

    // The account is flagged must-change (login gate is covered by the auth-flow specs).
    const getResponse = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.account.needsPasswordUpdate).toBe(true);
  });

  it('POST /accounts/:id/reset-password accepts an admin-supplied temporary password', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.reset.supplied',
        email: 'ctrlresetsupplied@example.com',
        displayName: 'Ctrl Reset Supplied',
        password: 'a-supplied-original-password',
        roleName: 'Nurse',
      });
    const accountId = createResponse.body.id;

    const resetResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ password: 'AdminTemp!123' });
    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body).toEqual({ success: true });
    expect(resetResponse.body.initialPassword).toBeUndefined();
  });

  it('POST /accounts/:id/reset-password returns 404 for an unknown account', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts/00000000-0000-0000-0000-000000000000/reset-password')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  describe('platform tenant (tenant-agnostic role catalog)', () => {
    beforeAll(() => {
      // Redirect "the platform tenant" to the test tenant the admin token is scoped to, so the
      // real __platform schema is never touched (same mechanism seed-initial-setup uses).
      process.env['PLATFORM_ADMIN_TENANT_ID'] = ctx.tenantId;
    });

    afterAll(() => {
      delete process.env['PLATFORM_ADMIN_TENANT_ID'];
    });

    it('GET /accounts/roles offers only platform roles: Super Admin, never hospital roles', async () => {
      const response = await request(app.getHttpServer())
        .get('/accounts/roles')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      const names = (response.body as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(['Super Admin']);
    });

    it('creates a Super Admin operator account', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'ctrl.platform.super',
          email: 'ctrlplatformsuper@example.com',
          displayName: 'Ctrl Platform Super',
          roleName: 'Super Admin',
        });

      expect(response.status).toBe(201);
      expect(response.body.username).toBe('ctrl.platform.super');
      expect(response.body.passwordHash).toBeUndefined();
    });

    it('rejects a hospital role (Doctor) with 400', async () => {
      const response = await request(app.getHttpServer())
        .post('/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'ctrl.platform.doctor',
          email: 'ctrlplatformdoctor@example.com',
          displayName: 'Ctrl Platform Doctor',
          roleName: 'Doctor',
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/hospital role/);
    });
  });

  it('lists accounts in the tenant with { items, total } pagination shape', async () => {
    const response = await request(app.getHttpServer()).get('/accounts').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(typeof response.body.total).toBe('number');
    expect(response.body.items.some((a: { username: string }) => a.username === 'ctrl.create.user')).toBe(true);
  });

  it('gets, deactivates, reactivates, and unlocks a single account', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        username: 'ctrl.lifecycle.user',
        email: 'ctrllifecycle@example.com',
        displayName: 'Ctrl Lifecycle User',
        password: 'a-lifecycle-password',
        roleName: 'Doctor',
      });
    const accountId = createResponse.body.id;

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.roleNames).toEqual(['Doctor']);

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.isActive).toBe(false);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.isActive).toBe(true);

    const unlockResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/unlock`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(unlockResponse.status).toBe(200);
    expect(unlockResponse.body.failedLoginAttempts).toBe(0);
  });

  it('returns 404 for an unknown account id', async () => {
    const response = await request(app.getHttpServer())
      .patch('/accounts/00000000-0000-0000-0000-000000000000/deactivate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(404);
  });

  it('returns 404 when assigning a role to an unknown account id', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts/00000000-0000-0000-0000-000000000000/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleName: 'Doctor' });
    expect(response.status).toBe(404);
  });

  it('rejects a non-date string in role startDate/endDate with 400 (not a 500)', async () => {
    // The DTO must reject malformed dates at validation time — `new Date('not-a-date')` is
    // Invalid Date, which TypeORM would send to a timestamptz column as a raw Postgres error
    // (500) if it ever reached the service.
    const response = await request(app.getHttpServer())
      .post('/accounts/00000000-0000-0000-0000-000000000000/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleName: 'Doctor', startDate: 'not-a-date' });
    expect(response.status).toBe(400);
  });

  it('assigns and revokes a role assignment', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
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
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleName: 'Doctor' });
    expect(assignResponse.status).toBe(201);
    const accountRoleId = assignResponse.body.id;

    const duplicateResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleName: 'Doctor' });
    expect(duplicateResponse.status).toBe(409);

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/accounts/${accountId}/roles/${accountRoleId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(revokeResponse.status).toBe(200);

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getResponse.body.roleNames).toEqual(['Nurse']);
  });
});
