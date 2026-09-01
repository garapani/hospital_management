import bcrypt from 'bcryptjs';
import { BadRequestException, ConflictException } from '@nestjs/common';
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
    // Helpdesk Agent's grants: helpdesk module (2026-08-20) plus the universal notification.read
    // (2026-08-26, notifications P2 — granted to every catalog role).
    expect(permissionsForHelpdesk.sort()).toEqual([
      'helpdesk.manage',
      'helpdesk.read',
      'notification.read',
    ]);
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
    expect(firstPage.items).toHaveLength(1);
    expect(typeof firstPage.total).toBe('number');
    const allAccounts = await ctx.inTenant(() => ctx.accountsService.listAccounts(50, 0));
    expect(allAccounts.items.map((a) => a.username)).toEqual(
      expect.arrayContaining(['list.user.1', 'list.user.2']),
    );
  });

  it('lists only active accounts holding an active assignment of the named role, minimal fields, sorted by name', async () => {
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dir.zeta',
        email: 'zeta@example.com',
        displayName: 'Dr. Zeta',
        password: 'password-zeta',
        roleName: 'Doctor',
      }),
    );
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dir.amara',
        email: 'amara@example.com',
        displayName: 'Dr. Amara',
        password: 'password-amara',
        roleName: 'Doctor',
      }),
    );
    const deactivated = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dir.deactivated',
        email: 'deact@example.com',
        displayName: 'Dr. Deactivated',
        password: 'password-deact',
        roleName: 'Doctor',
      }),
    );
    await ctx.inTenant(() => ctx.accountsService.deactivateAccount(deactivated.id));
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dir.nurse',
        email: 'nurse@example.com',
        displayName: 'Nurse Nia',
        password: 'password-nurse',
        roleName: 'Nurse',
      }),
    );

    const doctors = await ctx.inTenant(() => ctx.accountsService.listDirectory('Doctor'));
    const names = doctors.map((d) => d.displayName);

    // Other tests in this file share the same tenant schema and also create Doctor accounts, so
    // assert presence/shape/exclusion rather than the exact array (matches the established
    // pattern in "lists accounts in the current tenant with limit/offset" above).
    expect(names).toEqual(expect.arrayContaining(['Dr. Amara', 'Dr. Zeta']));
    expect(names).not.toContain('Dr. Deactivated');
    expect(names).not.toContain('Nurse Nia');
    // Sorted by displayName: Amara comes before Zeta wherever both land in the fuller list.
    expect(names.indexOf('Dr. Amara')).toBeLessThan(names.indexOf('Dr. Zeta'));
    const amara = doctors.find((d) => d.username === 'dir.amara');
    expect(amara).toEqual({ id: expect.any(String), displayName: 'Dr. Amara', username: 'dir.amara' });
  });

  it('returns an empty list for an unknown role name', async () => {
    const result = await ctx.inTenant(() => ctx.accountsService.listDirectory('Not A Real Role'));
    expect(result).toEqual([]);
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
    // P3: deactivating an already-deactivated account is rejected (catalog convention) —
    // previously it silently no-op'd.
    await expect(
      ctx.inTenant(() => ctx.accountsService.deactivateAccount(created.id)),
    ).rejects.toThrow(ConflictException);

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

  it('rejects an admin-supplied password shorter than 8 characters (create and reset)', async () => {
    // P2: admin-supplied passwords previously bypassed the 8-character minimum (only non-empty
    // was effectively checked) — a tenant could be provisioned with a 1-character password.
    await expect(
      ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'short.pw',
          email: 'short@example.com',
          displayName: 'Short PW',
          password: 'x',
          roleName: 'Nurse',
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    const created = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'short.reset',
        email: 'short-reset@example.com',
        displayName: 'Short Reset',
        password: 'long-enough-password',
        roleName: 'Nurse',
      }),
    );
    await expect(
      ctx.inTenant(() => ctx.accountsService.resetPassword(created.id, 'tiny')),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate staff username with ConflictException', async () => {
    // P3: duplicate staff usernames previously surfaced as a raw 500 — the patient-account path
    // already mapped 23505 to a 409; staff now does too.
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'dup.user',
        email: 'dup@example.com',
        displayName: 'Dup User',
        password: 'a-long-password',
        roleName: 'Nurse',
      }),
    );
    await expect(
      ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'dup.user',
          email: 'dup2@example.com',
          displayName: 'Dup User 2',
          password: 'a-long-password',
          roleName: 'Nurse',
        }),
      ),
    ).rejects.toThrow(ConflictException);
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

  describe('hospital tenants cannot gain cross-tenant roles or unenabled roles', () => {
    it('rejects creating a Super Admin account (cross-tenant role)', async () => {
      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.createStaffAccount({
            username: 'hospital.super',
            email: 'hospitalsuper@example.com',
            displayName: 'Hospital Super',
            password: 'a-password',
            roleName: 'Super Admin',
          }),
        ),
      ).rejects.toThrow('platform-only');
    });

    it('rejects assigning the Super Admin role to an existing account', async () => {
      const created = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'hospital.assignee',
          email: 'hospitalassignee@example.com',
          displayName: 'Hospital Assignee',
          password: 'a-password',
          roleName: 'Nurse',
        }),
      );

      await expect(
        ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Super Admin')),
      ).rejects.toThrow('platform-only');
    });

    it('rejects a role the registry tenant has not enabled (tenant_roles is authoritative)', async () => {
      const registryTenant = 'test_acct_registry_only';
      await ctx.dataSource.query(
        `INSERT INTO tenants ("hospitalId", "hospitalName", "status", "packageCode", "createdBy", "activatedAt")
         VALUES ($1, 'Registry Only', 'active', 'basic', 'accounts-spec', NOW())`,
        [registryTenant],
      );

      try {
        await expect(
          ctx.tenantContext.run({ tenantId: registryTenant, correlationId: 'acct-registry' }, () =>
            ctx.accountsService.createStaffAccount({
              username: 'registry.staff',
              email: 'registrystaff@example.com',
              displayName: 'Registry Staff',
              password: 'a-password',
              roleName: 'Nurse',
            }),
          ),
        ).rejects.toThrow('not enabled for this hospital');

        await expect(
          ctx.tenantContext.run({ tenantId: registryTenant, correlationId: 'acct-registry' }, () =>
            ctx.accountsService.assignRole('00000000-0000-0000-0000-000000000000', 'Nurse'),
          ),
        ).rejects.toThrow('not enabled for this hospital');
      } finally {
        await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [registryTenant]);
      }
    });

    it('rejects creating or assigning a deactivated role', async () => {
      const roleName = 'deactivated_role_spec';
      const repo = ctx.dataSource.getRepository(Role);
      await repo.save(
        repo.create({
          name: roleName,
          description: 'Temporary deactivated role',
          priority: 1,
          isCrossTenant: false,
          isActive: false,
        }),
      );

      try {
        await expect(
          ctx.inTenant(() =>
            ctx.accountsService.createStaffAccount({
              username: 'deact.user',
              email: 'deact@example.com',
              displayName: 'Deact User',
              password: 'a-password',
              roleName,
            }),
          ),
        ).rejects.toThrow('deactivated');

        const assignee = await ctx.inTenant(() =>
          ctx.accountsService.createStaffAccount({
            username: 'deact.assignee',
            email: 'deactassignee@example.com',
            displayName: 'Deact Assignee',
            password: 'a-password',
            roleName: 'Nurse',
          }),
        );
        await expect(
          ctx.inTenant(() => ctx.accountsService.assignRole(assignee.id, roleName)),
        ).rejects.toThrow('deactivated');
      } finally {
        await repo.delete({ name: roleName });
      }
    });
  });

  describe('admin password reset', () => {
    let accountId: string;

    beforeAll(async () => {
      const created = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'reset.me',
          email: 'reset@example.com',
          displayName: 'Reset Me',
          password: 'original-password-1',
          roleName: 'Nurse',
        }),
      );
      accountId = created.id;
    });

    it('generates a new password, forces a change, and clears lockout state', async () => {
      await ctx.inTenant(() =>
        ctx.accountsService.lockAccount(accountId, new Date(Date.now() + 60_000)),
      );

      const result = await ctx.inTenant(() => ctx.accountsService.resetPassword(accountId));
      expect(result.initialPassword).toBeDefined();

      const found = await ctx.inTenant(() => ctx.accountsService.findByUsernameWithRoles('reset.me'));
      expect(found?.account.needsPasswordUpdate).toBe(true);
      expect(found?.account.lockedUntil).toBeNull();
      expect(found?.account.failedLoginAttempts).toBe(0);
      expect(
        await bcrypt.compare('original-password-1', found!.account.passwordHash as string),
      ).toBe(false);
      expect(
        await bcrypt.compare(result.initialPassword as string, found!.account.passwordHash as string),
      ).toBe(true);
    });

    it('uses an admin-supplied temporary password as-is and still forces a change', async () => {
      await ctx.inTenant(() => ctx.accountsService.resetPassword(accountId, 'temp-pass-123'));

      const found = await ctx.inTenant(() => ctx.accountsService.findByUsernameWithRoles('reset.me'));
      expect(found?.account.needsPasswordUpdate).toBe(true);
      expect(
        await bcrypt.compare('temp-pass-123', found!.account.passwordHash as string),
      ).toBe(true);
    });

    it('rejects resetting an unknown account', async () => {
      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.resetPassword('00000000-0000-0000-0000-000000000000'),
        ),
      ).rejects.toThrow('not found');
    });
  });

  describe('platform-tenant operator accounts (tenant-agnostic roles)', () => {
    beforeAll(() => {
      // Redirect "the platform tenant" to this test-scoped tenant so the real __platform schema
      // (and its live superadmin) is never touched — same mechanism seed-initial-setup uses.
      process.env['PLATFORM_ADMIN_TENANT_ID'] = ctx.tenantId;
    });

    afterAll(() => {
      delete process.env['PLATFORM_ADMIN_TENANT_ID'];
    });

    it('listRoles is tenant-agnostic but platform-only: Super Admin, never hospital roles', async () => {
      const roles = await ctx.inTenant(() => ctx.accountsService.listRoles());
      const names = roles.map((r) => r.name);
      expect(names).toEqual(['Super Admin']);
    });

    it('creates a Super Admin operator account in the platform tenant', async () => {
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'platform.op1',
          email: 'op1@platform.local',
          displayName: 'Platform Operator One',
          password: 'op-password-123',
          roleName: 'Super Admin',
        }),
      );
      expect(account.username).toBe('platform.op1');

      const found = await ctx.inTenant(() => ctx.accountsService.findByUsernameWithRoles('platform.op1'));
      expect(found?.roleNames).toEqual(['Super Admin']);
    });

    it('rejects a hospital role (Doctor) for a platform operator account', async () => {
      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.createStaffAccount({
            username: 'platform.doctor',
            email: 'doctor@platform.local',
            displayName: 'Platform Doctor',
            password: 'op-password-789',
            roleName: 'Doctor',
          }),
        ),
      ).rejects.toThrow('hospital role');

      const created = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: 'platform.op2',
          email: 'op2@platform.local',
          displayName: 'Platform Operator Two',
          password: 'op-password-456',
          roleName: 'Super Admin',
        }),
      );
      await expect(
        ctx.inTenant(() => ctx.accountsService.assignRole(created.id, 'Doctor')),
      ).rejects.toThrow('hospital role');
    });

    it('protects the last Super Admin in the platform tenant from revocation', async () => {
      const superAdminRole = await ctx.dataSource
        .getRepository(Role)
        .findOneOrFail({ where: { name: 'Super Admin' } });

      const op1 = await ctx.inTenant(() =>
        ctx.accountsService.findByUsernameWithRoles('platform.op1'),
      );
      const op2 = await ctx.inTenant(() =>
        ctx.accountsService.findByUsernameWithRoles('platform.op2'),
      );

      const activeAssignments = (accountId: string) =>
        ctx.inTenant(() =>
          ctx.tenantConnection.runInTenantSchema((manager) =>
            manager
              .getRepository(AccountRole)
              .find({ where: { accountId, isActive: true } }),
          ),
        );

      const op1Assignments = await activeAssignments(op1!.account.id);
      const op2Assignments = await activeAssignments(op2!.account.id);
      const op1Super = op1Assignments.find((a) => a.roleId === superAdminRole.id);
      const op2Super = op2Assignments.find((a) => a.roleId === superAdminRole.id);
      expect(op1Super).toBeDefined();
      expect(op2Super).toBeDefined();

      // Two Super Admins exist, so removing one is fine...
      await ctx.inTenant(() =>
        ctx.accountsService.revokeRoleAssignment(op1!.account.id, op1Super!.id),
      );

      // ...but the second one is the last — revoking it would lock the platform out.
      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.revokeRoleAssignment(op2!.account.id, op2Super!.id),
        ),
      ).rejects.toThrow('last Super Admin');
    });
  });

  describe('createPatientAccount', () => {
    it('creates a login-capable account linked to the given patient, with no role assignment', async () => {
      const patientId = '00000000-0000-4000-8000-0000000000f1';
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createPatientAccount({
          patientId,
          username: `patient.portal.${Date.now()}`,
          email: 'patient@example.com',
          displayName: 'Jane Patient',
        }),
      );

      expect(account.accountType).toBe('patient');
      expect(account.patientId).toBe(patientId);
      expect(account.needsPasswordUpdate).toBe(true);
      expect(account.initialPassword).toBeTruthy();
      expect(
        await bcrypt.compare(account.initialPassword, account.passwordHash as string),
      ).toBe(true);

      const withRoles = await ctx.inTenant(() => ctx.accountsService.getAccountWithRoles(account.id));
      expect(withRoles?.roleIds).toEqual([]);
    });

    it('rejects a second invite for a patient that already has a portal account', async () => {
      const patientId = '00000000-0000-4000-8000-0000000000f2';
      await ctx.inTenant(() =>
        ctx.accountsService.createPatientAccount({
          patientId,
          username: `patient.portal.first.${Date.now()}`,
          email: null,
          displayName: 'First Invite',
        }),
      );

      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.createPatientAccount({
            patientId,
            username: `patient.portal.second.${Date.now()}`,
            email: null,
            displayName: 'Second Invite',
          }),
        ),
      ).rejects.toThrow('already has a portal account');
    });
  });

  describe('setWard', () => {
    async function makeWard(): Promise<string> {
      const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rows = await ctx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `INSERT INTO wards ("wardCode", "wardName") VALUES ($1, $2) RETURNING id`,
          [`W-${suffix}`, `Ward ${suffix}`],
        ),
      );
      return rows[0].id;
    }

    it('assigns a ward to a staff account', async () => {
      const wardId = await ctx.inTenant(() => makeWard());
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: `nurse.ward.${Date.now()}`,
          email: 'nurse.ward@example.com',
          displayName: 'Ward Nurse',
          password: 'correct horse battery staple',
          roleName: 'Nurse',
        }),
      );

      const updated = await ctx.inTenant(() => ctx.accountsService.setWard(account.id, wardId));
      expect(updated.wardId).toBe(wardId);
    });

    it('clears a ward assignment when wardId is null', async () => {
      const wardId = await ctx.inTenant(() => makeWard());
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: `nurse.clear.${Date.now()}`,
          email: 'nurse.clear@example.com',
          displayName: 'Clearable Nurse',
          password: 'correct horse battery staple',
          roleName: 'Nurse',
        }),
      );
      await ctx.inTenant(() => ctx.accountsService.setWard(account.id, wardId));

      const cleared = await ctx.inTenant(() => ctx.accountsService.setWard(account.id, null));
      expect(cleared.wardId).toBeNull();
    });

    it('rejects assigning a nonexistent ward', async () => {
      const account = await ctx.inTenant(() =>
        ctx.accountsService.createStaffAccount({
          username: `nurse.badward.${Date.now()}`,
          email: 'nurse.badward@example.com',
          displayName: 'Bad Ward Nurse',
          password: 'correct horse battery staple',
          roleName: 'Nurse',
        }),
      );

      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.setWard(account.id, '00000000-0000-0000-0000-000000000000'),
        ),
      ).rejects.toThrow('Ward');
    });

    it('rejects assigning a ward to a nonexistent account', async () => {
      const wardId = await ctx.inTenant(() => makeWard());
      await expect(
        ctx.inTenant(() =>
          ctx.accountsService.setWard('00000000-0000-0000-0000-000000000000', wardId),
        ),
      ).rejects.toThrow('Account');
    });
  });
});
