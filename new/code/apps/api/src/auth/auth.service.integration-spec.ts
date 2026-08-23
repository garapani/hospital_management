import { JwtService } from '@nestjs/jwt';
import { ObjectStorageService } from '@hospital/object-storage';
import { AuthService } from './auth.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AuthService (integration)', () => {
  let ctx: TenantTestContext;
  const jwtService = new JwtService({ secret: 'test-secret' });
  let authService: AuthService;
  let tenantsService: TenantsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'auth_service', seedRbac: true });
    const packagesService = new PackagesService(ctx.dataSource);
    tenantsService = new TenantsService(
      ctx.dataSource,
      new TenantProvisioningService(ctx.dataSource),
      ctx.tenantConnection,
      ctx.tenantContext,
      packagesService,
      ctx.accountsService,
      new ObjectStorageService(),
    );
    authService = new AuthService(
      ctx.accountsService,
      jwtService,
      ctx.tenantContext,
      packagesService,
      tenantsService,
    );

    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = 'test_auth_purge_refresh'`);
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dr.carol',
        email: 'carol@example.com',
        displayName: 'Dr. Carol',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'admin.amy',
        email: 'amy@example.com',
        displayName: 'Admin Amy',
        password: 'correct-password-123',
        roleName: 'Hospital Admin',
      }),
    );
  });

  afterAll(async () => {
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = 'test_auth_purge_refresh'`);
    await teardownTenantTestContext(ctx);
  });

  it('issues an access and refresh token for correct credentials', async () => {
    const result = await ctx.inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['roles']).toEqual(['Doctor']);
    expect(decoded['hospitalId']).toBe(ctx.tenantId);
  });

  it('returns invalidCredentials for a wrong password without revealing which field was wrong', async () => {
    const result = await ctx.inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'wrong-password' }),
    );
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('returns invalidCredentials for a username that does not exist', async () => {
    const result = await ctx.inTenant(() => authService.login({ username: 'nobody', password: 'x' }));
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('locks the account after 5 failed attempts and reports the remaining lock time', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ctx.inTenant(() => authService.login({ username: 'dr.carol', password: 'wrong-password' }));
    }

    const result = await ctx.inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ locked: true });
    expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });

  describe('must-change-password onboarding', () => {
    beforeAll(async () => {
      await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'fresh.staff',
          email: 'fresh@example.com',
          displayName: 'Fresh Staff',
          password: 'initial-pass-123',
          needsPasswordUpdate: true,
          roleName: 'Nurse',
        }),
      );
    });

    it('login with the initial password returns mustChangePassword and issues no tokens', async () => {
      const result = await ctx.inTenant(() =>
        authService.login({ username: 'fresh.staff', password: 'initial-pass-123' }),
      );

      expect(result).toEqual({ mustChangePassword: true });
    });

    it('rejects changeInitialPassword with a wrong current password', async () => {
      await expect(
        ctx.inTenant(() =>
          authService.changeInitialPassword('fresh.staff', 'wrong-current', 'some-new-pass-789'),
        ),
      ).rejects.toThrow('Invalid credentials');
    });

    it('rejects a new password shorter than 8 characters', async () => {
      await expect(
        ctx.inTenant(() =>
          authService.changeInitialPassword('fresh.staff', 'initial-pass-123', 'short'),
        ),
      ).rejects.toThrow('at least 8 characters');
    });

    it('rejects changeInitialPassword for an account not flagged must-change', async () => {
      await expect(
        ctx.inTenant(() =>
          authService.changeInitialPassword('dr.carol', 'correct-password-123', 'some-new-pass-789'),
        ),
      ).rejects.toThrow('not required to change its password');
    });

    it('changeInitialPassword replaces the password and clears the flag', async () => {
      await ctx.inTenant(() =>
        authService.changeInitialPassword('fresh.staff', 'initial-pass-123', 'brand-new-pass-456'),
      );

      const loginWithOld = await ctx.inTenant(() =>
        authService.login({ username: 'fresh.staff', password: 'initial-pass-123' }),
      );
      expect(loginWithOld).toEqual({ invalidCredentials: true });

      const loginWithNew = await ctx.inTenant(() =>
        authService.login({ username: 'fresh.staff', password: 'brand-new-pass-456' }),
      );
      expect('accessToken' in loginWithNew).toBe(true);
    });

    it('rejects refresh for an account whose password was reset to must-change after login', async () => {
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'refresh.mustchange',
          email: 'refreshmustchange@example.com',
          displayName: 'Refresh Must Change',
          password: 'a-valid-password-1',
          roleName: 'Nurse',
        }),
      );
      const loginResult = await ctx.inTenant(() =>
        authService.login({ username: 'refresh.mustchange', password: 'a-valid-password-1' }),
      );
      if (!('refreshToken' in loginResult)) {
        throw new Error('expected a successful login');
      }

      // Simulate an admin resetting the password while the account holds live tokens: the
      // refresh path must not bypass the login-time must-change gate.
      await ctx.dataSource.query(
        `UPDATE "tenant_${ctx.tenantId}".accounts SET "needsPasswordUpdate" = true WHERE id = $1`,
        [account.id],
      );

      const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
      expect(refreshResult).toEqual({ invalidToken: true });
    });
  });

  it("includes the account's real permissions in the JWT, not an empty placeholder", async () => {
    const result = await ctx.inTenant(() =>
      authService.login({ username: 'admin.amy', password: 'correct-password-123' }),
    );

    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['permissions']).toContain('identity.accounts.manage');
  });

  it('issues a new access token from a valid refresh token, reflecting current roles', async () => {
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'refresh.user',
        email: 'refreshuser@example.com',
        displayName: 'Refresh User',
        password: 'a-refresh-password',
        roleName: 'Nurse',
      }),
    );
    const loginResult = await ctx.inTenant(() =>
      authService.login({ username: 'refresh.user', password: 'a-refresh-password' }),
    );
    if (!('refreshToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    // JWT `iat` has second-level granularity: without this delay, a refresh issued in the same
    // wall-clock second as login would sign an identical payload and produce a byte-identical
    // token, making the "rotated" assertion below flaky rather than a real behavior check.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
    expect('accessToken' in refreshResult).toBe(true);
    if ('accessToken' in refreshResult) {
      expect(typeof refreshResult.refreshToken).toBe('string');
      expect(refreshResult.refreshToken).not.toBe(loginResult.refreshToken);
    }
  });

  it('rejects refresh when given an access token instead of a refresh token', async () => {
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'refresh.wrong.token',
        email: 'refreshwrong@example.com',
        displayName: 'Refresh Wrong Token',
        password: 'a-wrong-password',
        roleName: 'Nurse',
      }),
    );
    const loginResult = await ctx.inTenant(() =>
      authService.login({ username: 'refresh.wrong.token', password: 'a-wrong-password' }),
    );
    if (!('accessToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    const refreshResult = await authService.refresh({ refreshToken: loginResult.accessToken });
    expect(refreshResult).toEqual({ invalidToken: true });
  });

  it('rejects refresh with a malformed token', async () => {
    const refreshResult = await authService.refresh({ refreshToken: 'not-a-real-token' });
    expect(refreshResult).toEqual({ invalidToken: true });
  });

  it('rejects refresh for a deactivated account even with a still-valid refresh token', async () => {
    const account = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'refresh.deactivated',
        email: 'refreshdeactivated@example.com',
        displayName: 'Refresh Deactivated',
        password: 'a-deactivated-password',
        roleName: 'Nurse',
      }),
    );
    const loginResult = await ctx.inTenant(() =>
      authService.login({ username: 'refresh.deactivated', password: 'a-deactivated-password' }),
    );
    if (!('refreshToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    await ctx.inTenant(() => ctx.accountsService.deactivateAccount(account.id));

    const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
    expect(refreshResult).toEqual({ invalidToken: true });
  });

  describe('tenant-status login gate (suspended / archived hospitals)', () => {
    beforeAll(async () => {
      // Fresh account (dr.carol is locked by an earlier test) plus a registry row so the status
      // gate actually fires (it is fail-open without one).
      await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'status.user',
          email: 'status@example.com',
          displayName: 'Status User',
          password: 'status-password-123',
          roleName: 'Nurse',
        }),
      );
      await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'status.fresh',
          email: 'status.fresh@example.com',
          displayName: 'Status Fresh',
          password: 'status-pass-123',
          needsPasswordUpdate: true,
          roleName: 'Nurse',
        }),
      );
      await ctx.dataSource.query(
        `INSERT INTO tenants ("hospitalId", "hospitalName", "status", "packageCode", "createdBy", "activatedAt")
         VALUES ($1, 'Status Gate Hospital', 'suspended', 'basic', 'auth-spec', NOW())`,
        [ctx.tenantId],
      );
    });

    afterAll(async () => {
      await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [ctx.tenantId]);
    });

    it('blocks login for a suspended tenant', async () => {
      const result = await ctx.inTenant(() =>
        authService.login({ username: 'status.user', password: 'status-password-123' }),
      );
      expect(result).toEqual({ tenantInactive: true, reason: 'suspended' });
    });

    it('blocks login for an archived tenant', async () => {
      await ctx.dataSource.query(`UPDATE tenants SET status = 'archived' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      const result = await ctx.inTenant(() =>
        authService.login({ username: 'status.user', password: 'status-password-123' }),
      );
      expect(result).toEqual({ tenantInactive: true, reason: 'archived' });
    });

    it("blocks login for a 'purged' tenant via the status gate directly, not just the schema-access failure path", async () => {
      // Raw status flip, schema left untouched (unlike a real purgeTenant() call) — this
      // specifically proves checkTenantStatusGate's own 'active'-only allowlist rejects 'purged',
      // independent of refresh()'s separate schema-access-failure catch (2.23). login() reaches
      // this gate without ever touching the schema for a status this early, so this is the only
      // path that exercises the gate's own handling of the status value in isolation.
      await ctx.dataSource.query(`UPDATE tenants SET status = 'purged' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      const result = await ctx.inTenant(() =>
        authService.login({ username: 'status.user', password: 'status-password-123' }),
      );
      expect(result).toEqual({ tenantInactive: true, reason: 'purged' });
    });

    it('blocks changeInitialPassword for a suspended tenant', async () => {
      await ctx.dataSource.query(`UPDATE tenants SET status = 'suspended' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      await expect(
        ctx.inTenant(() => authService.changeInitialPassword('status.fresh', 'status-pass-123', 'new-pass-456'))
      ).rejects.toThrow(/Tenant is suspended/);
    });

    it('blocks changeInitialPassword for an archived tenant', async () => {
      await ctx.dataSource.query(`UPDATE tenants SET status = 'archived' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      await expect(
        ctx.inTenant(() => authService.changeInitialPassword('status.fresh', 'status-pass-123', 'new-pass-456'))
      ).rejects.toThrow(/Tenant is archived/);
    });

    it('allows login once the tenant is active again, and refresh is also blocked while inactive', async () => {
      await ctx.dataSource.query(`UPDATE tenants SET status = 'active' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      const loginResult = await ctx.inTenant(() =>
        authService.login({ username: 'status.user', password: 'status-password-123' }),
      );
      if (!('refreshToken' in loginResult)) {
        throw new Error('expected a successful login for an active tenant');
      }

      // Suspend again: an existing refresh token must not keep the session alive.
      await ctx.dataSource.query(`UPDATE tenants SET status = 'suspended' WHERE "hospitalId" = $1`, [
        ctx.tenantId,
      ]);
      const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
      expect(refreshResult).toEqual({ invalidToken: true });
    });
  });

  it('2.23: refresh with a token for a purged tenant returns invalidToken, not a raw 500', async () => {
    // provisionTenant end-to-end (real schema/registry row/enabled roles/bootstrap admin) rather
    // than the lighter-weight ctx.createTenant() helper: this test needs the tenant to have a
    // real registry row so purgeTenant is reachable, and a real registry row also switches on
    // createStaffAccount's role-membership enforcement (fail-open only applies to registry-less
    // test tenants), so the bootstrap admin's role must actually be enabled — provisionTenant
    // handles all of that itself instead of hand-rolling it.
    const hospitalId = 'test_auth_purge_refresh';
    const provisioned = await tenantsService.provisionTenant({
      hospitalId,
      hospitalName: 'Purge Refresh Hospital',
      // Explicit password so needsPasswordUpdate is false (a generated one forces a
      // mustChangePassword response on login instead of issuing tokens).
      adminPassword: 'a-purge-refresh-password',
    });

    const loginResult = await ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'test' }, () =>
      authService.login({
        username: provisioned.adminCredentials.username,
        password: provisioned.adminCredentials.password,
      }),
    );
    if (!('refreshToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    await tenantsService.archiveTenant(hospitalId);
    await tenantsService.purgeTenant(hospitalId, hospitalId);

    // The still-cryptographically-valid refresh token issued before the purge must be rejected
    // cleanly, not throw — the purged tenant's schema/role no longer exist to query against.
    const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
    expect(refreshResult).toEqual({ invalidToken: true });
  });

  it('2.32: login against a purged tenant returns invalidCredentials, not a raw 500', async () => {
    // Timestamp-suffixed, not a fixed id: purgeTenant tombstones the registry row permanently
    // (2.28 — status flips to 'purged', never deleted), so a fixed hospitalId here would 409 on
    // provisionTenant on every run after the first against a persistent dev DB (the same class of
    // gap as 3.8).
    const hospitalId = `test_auth_purge_login_${Date.now()}`;
    await tenantsService.provisionTenant({
      hospitalId,
      hospitalName: 'Purge Login Hospital',
      adminPassword: 'a-purge-login-password',
    });
    await tenantsService.archiveTenant(hospitalId);
    await tenantsService.purgeTenant(hospitalId, hospitalId);

    // Anti-enumeration: a login attempt against a purged tenant's hospitalId must be
    // indistinguishable from a wrong password/username, not a distinct outcome or a raw 500.
    const loginResult = await ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'test' }, () =>
      authService.login({ username: `admin.${hospitalId}`, password: 'a-purge-login-password' }),
    );
    expect(loginResult).toEqual({ invalidCredentials: true });
  });

  it('2.32: changeInitialPassword against a purged tenant is rejected cleanly, not a raw 500', async () => {
    // See the login test above for why this is timestamp-suffixed rather than a fixed id.
    const hospitalId = `test_auth_purge_cp_${Date.now()}`;
    await tenantsService.provisionTenant({
      hospitalId,
      hospitalName: 'Purge Change-Password Hospital',
      adminPassword: 'a-purge-cp-password',
    });
    await tenantsService.archiveTenant(hospitalId);
    await tenantsService.purgeTenant(hospitalId, hospitalId);

    await expect(
      ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'test' }, () =>
        authService.changeInitialPassword(
          `admin.${hospitalId}`,
          'a-purge-cp-password',
          'a-new-password-123',
        ),
      ),
    ).rejects.toThrow('Invalid credentials');
  });
});
