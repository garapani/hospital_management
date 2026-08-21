import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { PackagesService } from '../packages/packages.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AuthService (integration)', () => {
  let ctx: TenantTestContext;
  const jwtService = new JwtService({ secret: 'test-secret' });
  let authService: AuthService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'auth_service', seedRbac: true });
    authService = new AuthService(
      ctx.accountsService,
      jwtService,
      ctx.tenantContext,
      new PackagesService(ctx.dataSource),
    );

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

  afterAll(() => teardownTenantTestContext(ctx));

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
});
