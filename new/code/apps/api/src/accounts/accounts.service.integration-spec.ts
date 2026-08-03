import bcrypt from 'bcryptjs';
import { Role } from '../rbac/entities/role.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountsService (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounts', seedRbac: true });
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('creates a staff account with a hashed password and an assigned role', async () => {
    const account = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
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
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'nurse.bob',
        email: 'bob@example.com',
        displayName: 'Nurse Bob',
        password: 'another-strong-password',
        roleName: 'Nurse',
      }),
    );

    const found = await ctx.inTenant(() => ctx.accountsService.findByUsernameWithRoles('nurse.bob'));

    expect(found?.account.username).toBe('nurse.bob');
    expect(found?.roleNames).toEqual(['Nurse']);
  });

  it('returns null for a username that does not exist', async () => {
    const found = await ctx.inTenant(() => ctx.accountsService.findByUsernameWithRoles('nobody'));
    expect(found).toBeNull();
  });

  it('resolves permission names granted to a set of role ids', async () => {
    const hospitalAdminRole = await ctx.dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: 'Hospital Admin' } });

    const permissionsForAdmin = await ctx.accountsService.getPermissionNamesForRoles([hospitalAdminRole.id]);
    expect(permissionsForAdmin).toContain('identity.accounts.manage');

    const helpdeskRole = await ctx.dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Helpdesk Agent' } });
    const permissionsForHelpdesk = await ctx.accountsService.getPermissionNamesForRoles([helpdeskRole.id]);
    expect(permissionsForHelpdesk).toEqual([]);
  });

  it('creates a staff account with needsPasswordUpdate set when requested', async () => {
    const account = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
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
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'list.user.1',
        email: 'l1@example.com',
        displayName: 'List User 1',
        password: 'password-one',
        roleName: 'Nurse',
      }),
    );
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'list.user.2',
        email: 'l2@example.com',
        displayName: 'List User 2',
        password: 'password-two',
        roleName: 'Nurse',
      }),
    );

    const firstPage = await ctx.inTenant(() => ctx.accountsService.listAccounts(1, 0));
    expect(firstPage).toHaveLength(1);
    const allAccounts = await ctx.inTenant(() => ctx.accountsService.listAccounts(50, 0));
    expect(allAccounts.map((a) => a.username)).toEqual(
      expect.arrayContaining(['list.user.1', 'list.user.2']),
    );
  });

  it('gets a single account by id with its roles', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'getbyid.user',
        email: 'getbyid@example.com',
        displayName: 'Get By Id User',
        password: 'password-three',
        roleName: 'Doctor',
      }),
    );

    const found = await ctx.inTenant(() => ctx.accountsService.getAccountWithRoles(created.id));
    expect(found?.account.username).toBe('getbyid.user');
    expect(found?.roleNames).toEqual(['Doctor']);

    const notFound = await ctx.inTenant(() => ctx.accountsService.getAccountWithRoles('00000000-0000-0000-0000-000000000000'));
    expect(notFound).toBeNull();
  });

  it('deactivates and reactivates an account, idempotently', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'deactivate.user',
        email: 'deactivate@example.com',
        displayName: 'Deactivate User',
        password: 'password-four',
        roleName: 'Nurse',
      }),
    );

    const deactivated = await ctx.inTenant(() => ctx.accountsService.deactivateAccount(created.id));
    expect(deactivated.isActive).toBe(false);
    const deactivatedAgain = await ctx.inTenant(() => ctx.accountsService.deactivateAccount(created.id));
    expect(deactivatedAgain.isActive).toBe(false);

    const reactivated = await ctx.inTenant(() => ctx.accountsService.reactivateAccount(created.id));
    expect(reactivated.isActive).toBe(true);

    await expect(
      ctx.inTenant(() => ctx.accountsService.deactivateAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('admin-unlocks an account, clearing failed attempts and lock', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'unlock.user',
        email: 'unlock@example.com',
        displayName: 'Unlock User',
        password: 'password-five',
        roleName: 'Nurse',
      }),
    );
    await ctx.inTenant(() => ctx.accountsService.recordFailedLogin(created.id));
    await ctx.inTenant(() => ctx.accountsService.lockAccount(created.id, new Date(Date.now() + 60_000)));

    const unlocked = await ctx.inTenant(() => ctx.accountsService.adminUnlockAccount(created.id));
    expect(unlocked.failedLoginAttempts).toBe(0);
    expect(unlocked.lockedUntil).toBeNull();

    await expect(
      ctx.inTenant(() => ctx.accountsService.adminUnlockAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('assigns a role, rejects an unknown role name, and rejects a duplicate active assignment', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'assign.role.user',
        email: 'assignrole@example.com',
        displayName: 'Assign Role User',
        password: 'password-six',
        roleName: 'Nurse',
      }),
    );

    const assignment = await ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Doctor'));
    expect(assignment.roleId).toBeDefined();
    expect(assignment.isActive).toBe(true);

    const found = await ctx.inTenant(() => ctx.accountsService.getAccountWithRoles(created.id));
    expect(found?.roleNames.sort()).toEqual(['Doctor', 'Nurse']);

    await expect(ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Doctor'))).rejects.toThrow(
      'already holds',
    );
    await expect(ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Nonexistent Role'))).rejects.toThrow(
      'Unknown role',
    );
  });

  it('returns not found when assigning a role to a nonexistent account', async () => {
    await expect(
      ctx.inTenant(() => ctx.accountsService.assignRole('00000000-0000-0000-0000-000000000000', 'Doctor')),
    ).rejects.toThrow('not found');
  });

  it('revokes a role assignment, idempotently, and rejects an unknown assignment id', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'revoke.role.user',
        email: 'revokerole@example.com',
        displayName: 'Revoke Role User',
        password: 'password-seven',
        roleName: 'Nurse',
      }),
    );
    const assignment = await ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Doctor'));

    await ctx.inTenant(() => ctx.accountsService.revokeRoleAssignment(created.id, assignment.id));
    const foundAfterRevoke = await ctx.inTenant(() => ctx.accountsService.getAccountWithRoles(created.id));
    expect(foundAfterRevoke?.roleNames).toEqual(['Nurse']);

    await ctx.inTenant(() => ctx.accountsService.revokeRoleAssignment(created.id, assignment.id));

    await expect(
      ctx.inTenant(() => ctx.accountsService.revokeRoleAssignment(created.id, '00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('rejects a duplicate active role assignment even without the app-level check racing', async () => {
    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'race.role.user',
        email: 'racerole@example.com',
        displayName: 'Race Role User',
        password: 'password-eight',
        roleName: 'Nurse',
      }),
    );
    const doctorRole = await ctx.dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Doctor' } });

    const insertBoth = () =>
      ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
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
