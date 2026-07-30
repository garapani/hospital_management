import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsService } from './accounts.service.js';

describe('AccountsService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);

  beforeAll(async () => {
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_accounts');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_accounts" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_accounts', correlationId: 'test' }, work);
  }

  it('creates a staff account with a hashed password and an assigned role', async () => {
    const account = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'dr.alice',
        email: 'alice@example.com',
        displayName: 'Dr. Alice',
        password: 'correct horse battery staple',
        roleName: 'Doctor',
      }),
    );

    expect(account.username).toBe('dr.alice');
    expect(account.passwordHash).not.toBe('correct horse battery staple');
    expect(await bcrypt.compare('correct horse battery staple', account.passwordHash as string)).toBe(
      true,
    );
  });

  it('finds an account by username together with its active role names', async () => {
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'nurse.bob',
        email: 'bob@example.com',
        displayName: 'Nurse Bob',
        password: 'another-strong-password',
        roleName: 'Nurse',
      }),
    );

    const found = await inTenant(() => accountsService.findByUsernameWithRoles('nurse.bob'));

    expect(found?.account.username).toBe('nurse.bob');
    expect(found?.roleNames).toEqual(['Nurse']);
  });

  it('returns null for a username that does not exist', async () => {
    const found = await inTenant(() => accountsService.findByUsernameWithRoles('nobody'));
    expect(found).toBeNull();
  });
});
