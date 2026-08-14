import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { TenantsModule } from './tenants.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';
import { PLATFORM_TENANT_ID } from './platform-tenant.js';

describe('TenantsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let adminToken: string;
  // Set by the "omits the reserved platform tenant" test iff it inserted the __platform row
  // itself. __platform is a single global literal (unlike the test_tenant_ctrl_% namespace), and
  // Task 2 seeds a real __platform tenant into this same database — afterAll must only delete the
  // row this suite created, never a pre-existing one, or it breaks platform-admin login on
  // developer machines that already ran the seed.
  let platformTenantInsertedByThisSuite = false;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_ctrl', seedRbac: true });
    adminToken = await signTestToken({
      sub: 'tenants-controller-admin',
      hospitalId: ctx.tenantId,
      permissions: ['system-admin.tenants.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [TenantsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const jwtService = new JwtService({ secret: resolveJwtSecret() });

    app = moduleRef.createNestApplication();
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    await app.init();
  });

  afterAll(async () => {
    const hospitalIds: { hospitalId: string }[] = await ctx.dataSource.query(
      `SELECT "hospitalId" FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`,
    );
    for (const { hospitalId } of hospitalIds) {
      const name = `tenant_${hospitalId}`;
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${name}"`);
    }
    // Conditional on purpose: __platform is a single global literal, not a test_tenant_ctrl_%
    // namespaced row. Task 2 seeds a real __platform tenant into this same database, so an
    // unconditional delete here would silently remove a developer's real platform-tenant row and
    // break their platform-admin login until they re-seed. Only remove it if this suite is the one
    // that inserted it.
    if (platformTenantInsertedByThisSuite) {
      await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [PLATFORM_TENANT_ID]);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'`);
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('provisions a tenant and returns it', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_create', hospitalName: 'Ctrl Create Hospital' });

    expect(response.status).toBe(201);
    expect(response.body.hospitalId).toBe('test_tenant_ctrl_create');
    expect(response.body.status).toBe('active');
  });

  it('rejects provisioning a duplicate hospitalId with 409', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital' });

    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_dup', hospitalName: 'Dup Hospital Again' });

    expect(response.status).toBe(409);
  });

  it('lists tenants', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_list', hospitalName: 'List Hospital' });

    const response = await request(app.getHttpServer()).get('/tenants').set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(
      response.body.some((t: { hospitalId: string }) => t.hospitalId === 'test_tenant_ctrl_list'),
    ).toBe(true);
  });

  it('gets a single tenant, 404 for an unknown one', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_get', hospitalName: 'Get Hospital' });

    const found = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_get')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(found.status).toBe(200);
    expect(found.body.hospitalName).toBe('Get Hospital');

    const missing = await request(app.getHttpServer())
      .get('/tenants/test_tenant_ctrl_nonexistent')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });

  it('suspends and reactivates a tenant', async () => {
    await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: 'test_tenant_ctrl_lifecycle', hospitalName: 'Lifecycle Hospital' });

    const suspended = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/suspend')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(suspended.status).toBe(200);
    expect(suspended.body.status).toBe('suspended');

    const reactivated = await request(app.getHttpServer())
      .patch('/tenants/test_tenant_ctrl_lifecycle/reactivate')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('active');
  });

  it('rejects provisioning the reserved platform tenant id with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: PLATFORM_TENANT_ID, hospitalName: 'Should Not Exist' });

    expect(response.status).toBe(400);
  });

  it('omits the reserved platform tenant from the tenant list', async () => {
    const inserted: { hospitalId: string }[] = await ctx.dataSource.query(
      `INSERT INTO tenants ("hospitalId", "hospitalName", status, "createdBy")
       VALUES ($1, 'Platform', 'active', 'test')
       ON CONFLICT ("hospitalId") DO NOTHING
       RETURNING "hospitalId"`,
      [PLATFORM_TENANT_ID],
    );
    // ON CONFLICT DO NOTHING returns no row when __platform already existed (e.g. seeded by
    // Task 2's provisioning) — only claim ownership of the row when we actually created it, so
    // afterAll knows whether it's safe to delete.
    if (inserted.length > 0) {
      platformTenantInsertedByThisSuite = true;
    }

    const response = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const ids = response.body.map((t: { hospitalId: string }) => t.hospitalId);
    expect(ids).not.toContain(PLATFORM_TENANT_ID);
  });

  it('returns 404 for a direct fetch of the reserved platform tenant', async () => {
    const response = await request(app.getHttpServer())
      .get(`/tenants/${PLATFORM_TENANT_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('refuses to suspend the reserved platform tenant with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/tenants/${PLATFORM_TENANT_ID}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  it('refuses to reactivate the reserved platform tenant with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/tenants/${PLATFORM_TENANT_ID}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });

  describe('per-tenant role enablement', () => {
    const hospitalId = 'test_tenant_ctrl_roles';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/tenants')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hospitalId, hospitalName: 'Roles Hospital' });
    });

    async function getRoles() {
      const response = await request(app.getHttpServer())
        .get(`/tenants/${hospitalId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`);
      return response;
    }

    it('returns the whole catalog with an enabled flag per role', async () => {
      const response = await getRoles();

      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThan(1);
      for (const role of response.body) {
        expect(role).toEqual(
          expect.objectContaining({
            id: expect.any(String),
            name: expect.any(String),
            enabled: expect.any(Boolean),
          }),
        );
      }
    });

    it('enables exactly the requested roles and disables the rest', async () => {
      const all = (await getRoles()).body as { id: string; name: string }[];
      const keep = all.slice(0, 2).map((role) => role.id);

      const response = await request(app.getHttpServer())
        .patch(`/tenants/${hospitalId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: keep });

      expect(response.status).toBe(200);
      const enabled = (response.body as { id: string; enabled: boolean }[])
        .filter((role) => role.enabled)
        .map((role) => role.id);
      expect(enabled.sort()).toEqual([...keep].sort());
    });

    it('rejects an unknown roleId with 400', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/tenants/${hospitalId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: ['00000000-0000-0000-0000-000000000000'] });

      expect(response.status).toBe(400);
    });

    it('refuses to disable a role that an account still holds, naming the holder', async () => {
      const all = (await getRoles()).body as { id: string; name: string }[];
      const doctor = all.find((role) => role.name === 'Doctor') ?? all[0];

      // Enable everything, then give an account the role we are about to try to remove.
      await request(app.getHttpServer())
        .patch(`/tenants/${hospitalId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: all.map((role) => role.id) });

      const schema = `tenant_${hospitalId}`;
      const [account] = await ctx.dataSource.query(
        `INSERT INTO "${schema}".accounts
           ("accountType", "displayName", username, email, "passwordHash")
         VALUES ('staff', 'Roles Blocker', 'rolesblocker', 'rolesblocker@test.local', 'x')
         RETURNING id`,
      );
      await ctx.dataSource.query(
        `INSERT INTO "${schema}".account_roles ("accountId", "roleId", "isActive")
         VALUES ($1, $2, true)`,
        [account.id, doctor.id],
      );

      const response = await request(app.getHttpServer())
        .patch(`/tenants/${hospitalId}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: all.filter((role) => role.id !== doctor.id).map((role) => role.id) });

      expect(response.status).toBe(409);
      expect(response.body.blocked).toEqual([
        expect.objectContaining({
          roleId: doctor.id,
          roleName: doctor.name,
          accounts: ['rolesblocker'],
        }),
      ]);

      // And the role really is still enabled — the refusal must not partially apply.
      const after = (await getRoles()).body as { id: string; enabled: boolean }[];
      expect(after.find((role) => role.id === doctor.id)?.enabled).toBe(true);
    });
  });
});
