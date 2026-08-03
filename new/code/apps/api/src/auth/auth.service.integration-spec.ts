import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
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
    authService = new AuthService(ctx.accountsService, jwtService, ctx.tenantContext);

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
});
