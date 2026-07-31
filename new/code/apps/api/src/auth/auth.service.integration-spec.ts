import { JwtService } from '@nestjs/jwt';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuthService } from './auth.service.js';

describe('AuthService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const jwtService = new JwtService({ secret: 'test-secret' });
  const authService = new AuthService(accountsService, jwtService, tenantContext);

  beforeAll(async () => {
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_auth');
    await tenantContext.run({ tenantId: 'test_auth', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'dr.carol',
        email: 'carol@example.com',
        displayName: 'Dr. Carol',
        password: 'correct-password-123',
        roleName: 'Doctor',
      }),
    );
    await tenantContext.run({ tenantId: 'test_auth', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'admin.amy',
        email: 'amy@example.com',
        displayName: 'Admin Amy',
        password: 'correct-password-123',
        roleName: 'Hospital Admin',
      }),
    );
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_auth" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_auth', correlationId: 'test' }, work);
  }

  it('issues an access and refresh token for correct credentials', async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String) });
    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['roles']).toEqual(['Doctor']);
    expect(decoded['hospitalId']).toBe('test_auth');
  });

  it('returns invalidCredentials for a wrong password without revealing which field was wrong', async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'wrong-password' }),
    );
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('returns invalidCredentials for a username that does not exist', async () => {
    const result = await inTenant(() => authService.login({ username: 'nobody', password: 'x' }));
    expect(result).toEqual({ invalidCredentials: true });
  });

  it('locks the account after 5 failed attempts and reports the remaining lock time', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await inTenant(() => authService.login({ username: 'dr.carol', password: 'wrong-password' }));
    }

    const result = await inTenant(() =>
      authService.login({ username: 'dr.carol', password: 'correct-password-123' }),
    );

    expect(result).toMatchObject({ locked: true });
    expect((result as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });

  it("includes the account's real permissions in the JWT, not an empty placeholder", async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'admin.amy', password: 'correct-password-123' }),
    );

    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['permissions']).toContain('identity.accounts.manage');
  });
});
