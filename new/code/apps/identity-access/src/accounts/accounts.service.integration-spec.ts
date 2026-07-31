import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { Role } from '../rbac/entities/role.entity.js';
import { AccountsService } from './accounts.service.js';
import { AccountRole } from './entities/account-role.entity.js';

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

  it('resolves permission names granted to a set of role ids', async () => {
    const hospitalAdminRole = await dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: 'Hospital Admin' } });
    const doctorRole = await dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Doctor' } });

    const permissionsForAdmin = await accountsService.getPermissionNamesForRoles([hospitalAdminRole.id]);
    expect(permissionsForAdmin).toEqual(['identity.accounts.manage']);

    const permissionsForDoctor = await accountsService.getPermissionNamesForRoles([doctorRole.id]);
    expect(permissionsForDoctor).toEqual([]);
  });

  it('creates a staff account with needsPasswordUpdate set when requested', async () => {
    const account = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'temp.pw.user',
        email: 'temp@example.com',
        displayName: 'Temp Password User',
        password: 'a-temp-password',
        roleName: 'Nurse',
        needsPasswordUpdate: true,
      }),
    );
    expect(account.needsPasswordUpdate).toBe(true);
  });

  it('lists accounts in the current tenant with limit/offset', async () => {
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'list.user.1',
        email: 'l1@example.com',
        displayName: 'List User 1',
        password: 'password-one',
        roleName: 'Nurse',
      }),
    );
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'list.user.2',
        email: 'l2@example.com',
        displayName: 'List User 2',
        password: 'password-two',
        roleName: 'Nurse',
      }),
    );

    const firstPage = await inTenant(() => accountsService.listAccounts(1, 0));
    expect(firstPage).toHaveLength(1);
    const allAccounts = await inTenant(() => accountsService.listAccounts(50, 0));
    expect(allAccounts.map((a) => a.username)).toEqual(
      expect.arrayContaining(['list.user.1', 'list.user.2']),
    );
  });

  it('gets a single account by id with its roles', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'getbyid.user',
        email: 'getbyid@example.com',
        displayName: 'Get By Id User',
        password: 'password-three',
        roleName: 'Doctor',
      }),
    );

    const found = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(found?.account.username).toBe('getbyid.user');
    expect(found?.roleNames).toEqual(['Doctor']);

    const notFound = await inTenant(() => accountsService.getAccountWithRoles('00000000-0000-0000-0000-000000000000'));
    expect(notFound).toBeNull();
  });

  it('deactivates and reactivates an account, idempotently', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'deactivate.user',
        email: 'deactivate@example.com',
        displayName: 'Deactivate User',
        password: 'password-four',
        roleName: 'Nurse',
      }),
    );

    const deactivated = await inTenant(() => accountsService.deactivateAccount(created.id));
    expect(deactivated.isActive).toBe(false);
    const deactivatedAgain = await inTenant(() => accountsService.deactivateAccount(created.id));
    expect(deactivatedAgain.isActive).toBe(false);

    const reactivated = await inTenant(() => accountsService.reactivateAccount(created.id));
    expect(reactivated.isActive).toBe(true);

    await expect(
      inTenant(() => accountsService.deactivateAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('admin-unlocks an account, clearing failed attempts and lock', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'unlock.user',
        email: 'unlock@example.com',
        displayName: 'Unlock User',
        password: 'password-five',
        roleName: 'Nurse',
      }),
    );
    await inTenant(() => accountsService.recordFailedLogin(created.id));
    await inTenant(() => accountsService.lockAccount(created.id, new Date(Date.now() + 60_000)));

    const unlocked = await inTenant(() => accountsService.adminUnlockAccount(created.id));
    expect(unlocked.failedLoginAttempts).toBe(0);
    expect(unlocked.lockedUntil).toBeNull();

    await expect(
      inTenant(() => accountsService.adminUnlockAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('assigns a role, rejects an unknown role name, and rejects a duplicate active assignment', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'assign.role.user',
        email: 'assignrole@example.com',
        displayName: 'Assign Role User',
        password: 'password-six',
        roleName: 'Nurse',
      }),
    );

    const assignment = await inTenant(() => accountsService.assignRole(created.id, 'Doctor'));
    expect(assignment.roleId).toBeDefined();
    expect(assignment.isActive).toBe(true);

    const found = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(found?.roleNames.sort()).toEqual(['Doctor', 'Nurse']);

    await expect(inTenant(() => accountsService.assignRole(created.id, 'Doctor'))).rejects.toThrow(
      'already holds',
    );
    await expect(inTenant(() => accountsService.assignRole(created.id, 'Nonexistent Role'))).rejects.toThrow(
      'Unknown role',
    );
  });

  it('revokes a role assignment, idempotently, and rejects an unknown assignment id', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'revoke.role.user',
        email: 'revokerole@example.com',
        displayName: 'Revoke Role User',
        password: 'password-seven',
        roleName: 'Nurse',
      }),
    );
    const assignment = await inTenant(() => accountsService.assignRole(created.id, 'Doctor'));

    await inTenant(() => accountsService.revokeRoleAssignment(created.id, assignment.id));
    const foundAfterRevoke = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(foundAfterRevoke?.roleNames).toEqual(['Nurse']);

    await inTenant(() => accountsService.revokeRoleAssignment(created.id, assignment.id));

    await expect(
      inTenant(() => accountsService.revokeRoleAssignment(created.id, '00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('rejects a duplicate active role assignment even without the app-level check racing', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'race.role.user',
        email: 'racerole@example.com',
        displayName: 'Race Role User',
        password: 'password-eight',
        roleName: 'Nurse',
      }),
    );
    const doctorRole = await dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Doctor' } });

    const insertBoth = () =>
      inTenant(() =>
        tenantConnection.runInTenantSchema((manager) =>
          Promise.allSettled([
            manager.getRepository(AccountRole).save(
              manager.getRepository(AccountRole).create({ accountId: created.id, roleId: doctorRole.id }),
            ),
            manager.getRepository(AccountRole).save(
              manager.getRepository(AccountRole).create({ accountId: created.id, roleId: doctorRole.id }),
            ),
          ]),
        ),
      );

    const results = await insertBoth();
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
