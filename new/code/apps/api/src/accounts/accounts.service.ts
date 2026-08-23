import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { Account } from './entities/account.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { resolvePlatformTenantId } from '../tenants/platform-tenant.js';

const BCRYPT_SALT_ROUNDS = 12;

/** 12-character initial password (URL-safe). */
function generateInitialPassword(): string {
  return randomBytes(9).toString('base64url');
}

export interface CreateStaffAccountInput {
  username: string;
  email: string;
  displayName: string;
  /** Optional initial password; when omitted the service generates one (returned once). */
  password?: string;
  roleName: string;
  needsPasswordUpdate?: boolean;
  /**
   * INTERNAL escape hatch — seed/bootstrap code only. Allows assigning a cross-tenant role
   * (Super Admin) and skips the tenant_roles membership check, which is exactly what the
   * platform tenant's bootstrap needs (its tenant_roles deliberately excludes cross-tenant
   * roles). The HTTP controller always forces this to false, so it can never be forged by a
   * request body.
   */
  allowPlatformRole?: boolean;
}

export interface CreateStaffAccountResult extends Account {
  /** Set once when the initial password was generated — never returned again. */
  initialPassword?: string;
}

export interface CreatePatientAccountInput {
  patientId: string;
  username: string;
  email: string | null;
  displayName: string;
}

export interface CreatePatientAccountResult extends Account {
  /** Set once, at creation — never returned again. The patient sets their own password from this. */
  initialPassword: string;
}

export interface AccountWithRoles {
  account: Account;
  roleIds: string[];
  roleNames: string[];
  /** Active role assignments with their ids, so clients can revoke a specific assignment. */
  assignments: { id: string; roleId: string; roleName: string }[];
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createStaffAccount(input: CreateStaffAccountInput): Promise<CreateStaffAccountResult> {
    let role: Role;
    try {
      role = await this.dataSource.getRepository(Role).findOneOrFail({
        where: { name: input.roleName },
      });
    } catch {
      throw new BadRequestException(`Unknown role: ${input.roleName}`);
    }
    if (!role.isActive) {
      throw new BadRequestException(`Role ${role.name} has been deactivated and cannot be assigned`);
    }

    // A hospital tenant must never hold cross-tenant (Super Admin) roles, and staff can only be
    // given roles the tenant's package/provisioning enabled — otherwise the role picker (which
    // lists enabled roles) and the API would disagree, and a crafted request could create a
    // Super Admin account. tenant_roles is the single source of truth for "enabled for tenant".
    // The platform tenant is the mirror image: its operators are tenant-agnostic but platform-only
    // — only cross-tenant (Super Admin) roles are offered there, never hospital roles like
    // Doctor/Nurse. The seed's internal allowPlatformRole escape hatch (test-scoped platform
    // tenants) is the only other cross-tenant path, and the HTTP layer can never set it.
    const isPlatformTenant = this.tenantContext.getTenantId() === resolvePlatformTenantId();
    const platformBypass =
      role.isCrossTenant && (input.allowPlatformRole === true || isPlatformTenant);
    if (role.isCrossTenant && !platformBypass) {
      throw new BadRequestException(
        `Role ${role.name} is platform-only and cannot be assigned to a hospital tenant account`,
      );
    }
    if (!role.isCrossTenant && isPlatformTenant) {
      throw new BadRequestException(
        `Role ${role.name} is a hospital role and cannot be assigned to a platform operator account`,
      );
    }
    const tenantId = this.tenantContext.getTenantId();
    // Enforce role-membership only for real registry tenants (the same fail-open rule
    // PackagesService.filterPermissions uses): test contexts provision schema-only tenants
    // without a registry row, and tenant_roles FKs to the registry. Real customer tenants always
    // have a row, so the guard is effective where it matters.
    const registryRow: { hospitalId: string }[] = tenantId
      ? await this.dataSource.query(`SELECT "hospitalId" FROM tenants WHERE "hospitalId" = $1`, [
          tenantId,
        ])
      : [];
    if (registryRow.length > 0 && !platformBypass) {
      const enabled: { roleId: string }[] = await this.dataSource.query(
        `SELECT "roleId" FROM tenant_roles WHERE "tenantId" = $1 AND "roleId" = $2`,
        [tenantId, role.id],
      );
      if (enabled.length === 0) {
        throw new BadRequestException(
          `Role ${role.name} is not enabled for this hospital. Enable it on the tenant page first.`,
        );
      }
    }

    const generatedPassword = input.password ? undefined : generateInitialPassword();
    const password = input.password ?? generatedPassword;
    // A generated initial password always forces a change on first login — the client cannot
    // suppress that with a forged needsPasswordUpdate field. An admin-supplied password honors
    // the explicit flag (seed/bootstrap pass false).
    const needsPasswordUpdate = input.password
      ? (input.needsPasswordUpdate ?? false)
      : true;
    const passwordHash = await bcrypt.hash(password as string, BCRYPT_SALT_ROUNDS);

    const account = await this.tenantConnection.runInTenantSchema(async (manager) => {
      const saved = await manager.getRepository(Account).save(
        manager.getRepository(Account).create({
          accountType: 'staff',
          username: input.username,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          needsPasswordUpdate,
        }),
      );
      await manager.getRepository(AccountRole).save(
        manager.getRepository(AccountRole).create({
          accountId: saved.id,
          roleId: role.id,
        }),
      );
      return saved;
    });

    return generatedPassword ? { ...account, initialPassword: generatedPassword } : account;
  }

  /**
   * Staff-initiated patient-portal invite: creates a login-capable account linked to exactly one
   * existing Patient record. Always generates the initial password (never admin-supplied — staff
   * must never know a patient's credential) and always forces a change on first use, reusing the
   * same needsPasswordUpdate/changeInitialPassword flow already built for staff onboarding. No
   * role assignment: patient accounts are gated by PatientAuthGuard (accountType === 'patient'),
   * not the staff RBAC catalog.
   */
  async createPatientAccount(input: CreatePatientAccountInput): Promise<CreatePatientAccountResult> {
    const generatedPassword = generateInitialPassword();
    const passwordHash = await bcrypt.hash(generatedPassword, BCRYPT_SALT_ROUNDS);

    const account = await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const existing = await repository.findOne({ where: { patientId: input.patientId } });
      if (existing) {
        throw new ConflictException(`Patient ${input.patientId} already has a portal account`);
      }
      try {
        return await repository.save(
          repository.create({
            accountType: 'patient',
            patientId: input.patientId,
            username: input.username,
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            needsPasswordUpdate: true,
          }),
        );
      } catch (error) {
        // The partial unique index on patientId (and the plain unique constraint on username)
        // close the same race the proactive check above can't: concurrent invites for the same
        // patient, or a username collision with any other account.
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictException(
            `Could not create the portal account — username or patient already has one`,
          );
        }
        throw error;
      }
    });

    return { ...account, initialPassword: generatedPassword };
  }

  async findByUsernameWithRoles(username: string): Promise<AccountWithRoles | null> {
    const account = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).findOne({ where: { username } }),
    );
    if (!account) {
      return null;
    }
    return this.attachRoles(account);
  }

  async getPermissionNamesForRoles(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) {
      return [];
    }
    const rolePermissions = await this.dataSource
      .getRepository(RolePermission)
      .find({ where: { roleId: In(roleIds) } });
    const permissionIds = [...new Set(rolePermissions.map((rp) => rp.permissionId))];
    if (permissionIds.length === 0) {
      return [];
    }
    const permissions = await this.dataSource
      .getRepository(Permission)
      .find({ where: { id: In(permissionIds) } });
    return permissions.map((permission) => permission.name);
  }

  private async attachRoles(account: Account): Promise<AccountWithRoles> {
    const accountRoles = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(AccountRole).find({ where: { accountId: account.id, isActive: true } }),
    );
    const roleIds = accountRoles.map((accountRole) => accountRole.roleId);
    const roles =
      roleIds.length === 0
        ? []
        : await this.dataSource.getRepository(Role).find({ where: { id: In(roleIds) } });
    const roleNameById = new Map(roles.map((role) => [role.id, role.name]));

    return {
      account,
      roleIds,
      roleNames: roles.map((role) => role.name),
      assignments: accountRoles.map((accountRole) => ({
        id: accountRole.id,
        roleId: accountRole.roleId,
        roleName: roleNameById.get(accountRole.roleId) ?? 'Unknown role',
      })),
    };
  }

  /**
   * Credential-verified password change keyed by username, for flows with no session yet (the
   * must-change-password onboarding after login with an initial/generated password). Same
   * current-password proof as login, so this never discloses whether a username exists: both a
   * missing account and a wrong password surface as one "Invalid credentials" 401.
   */
  async changePasswordByUsername(
    username: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { username } });
      const matches =
        account?.passwordHash !== null &&
        (account ? await bcrypt.compare(currentPassword, account.passwordHash) : false);
      if (!account || !matches) {
        throw new UnauthorizedException('Invalid credentials');
      }
      account.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      account.needsPasswordUpdate = false;
      await repository.save(account);
    });
  }

  /**
   * Self-service password change for the authenticated account. Verifies the current password,
   * sets the new one, and clears `needsPasswordUpdate` (the flag that blocks login until the
   * initial/generated password is replaced).
   */
  async changeOwnPassword(currentPassword: string, newPassword: string): Promise<void> {
    const accountId = this.tenantContext.getAccountId();
    if (!accountId) {
      throw new BadRequestException('No authenticated account in context');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }

    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException('Account not found');
      }
      const matches =
        account.passwordHash !== null &&
        (await bcrypt.compare(currentPassword, account.passwordHash));
      if (!matches) {
        throw new BadRequestException('Current password is incorrect');
      }
      const newHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      account.passwordHash = newHash;
      account.needsPasswordUpdate = false;
      await repository.save(account);
    });
  }

  async recordFailedLogin(accountId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        return;
      }
      account.failedLoginAttempts += 1;
      await repository.save(account);
    });
  }

  async lockAccount(accountId: string, lockedUntil: Date): Promise<void> {
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        return;
      }
      account.lockedUntil = lockedUntil;
      await repository.save(account);
    });
  }

  async resetFailedLogins(accountId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        return;
      }
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      await repository.save(account);
    });
  }

  async listAccounts(limit: number, offset: number): Promise<Account[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).find({ take: limit, skip: offset, order: { createdAt: 'ASC' } }),
    );
  }

  async listRoles(): Promise<Role[]> {
    const query = this.dataSource.getRepository(Role)
      .createQueryBuilder('role')
      .orderBy('role.priority', 'DESC')
      .addOrderBy('role.name', 'ASC');

    const tenantId = this.tenantContext.getTenantId();
    if (tenantId && tenantId === resolvePlatformTenantId()) {
      // Platform operators are tenant-agnostic but platform-only: offer just the cross-tenant
      // (Super Admin) roles — never hospital roles like Doctor/Nurse, which have no meaning in
      // the platform tenant and would leak hospital permissions into platform JWTs.
      query.where('role."isCrossTenant" = true').andWhere('role."isActive" = true');
    } else if (tenantId) {
      // Package-gated hospital tenants only see roles their tenant_roles enabled.
      query
        .innerJoin('tenant_roles', 'tr', 'tr."roleId" = role.id')
        .where('tr."tenantId" = :tenantId', { tenantId })
        .andWhere('role."isActive" = true');
    }

    return query.getMany();
  }

  async getAccountWithRoles(accountId: string): Promise<AccountWithRoles | null> {
    const account = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).findOne({ where: { id: accountId } }),
    );
    if (!account) {
      return null;
    }
    return this.attachRoles(account);
  }

  async deactivateAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.isActive = false;
      return repository.save(account);
    });
  }

  async reactivateAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.isActive = true;
      return repository.save(account);
    });
  }

  async adminUnlockAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      return repository.save(account);
    });
  }

  /**
   * Admin-initiated password reset (forgotten-password recovery). Always forces a change on next
   * login and clears lockout state; an optional admin-supplied temporary password is used as-is,
   * otherwise one is generated and returned once — same one-time disclosure rule as
   * createStaffAccount. Unlike create (where an admin-chosen password is the real password), a
   * reset is recovery, so the must-change gate stays on either way.
   */
  async resetPassword(
    accountId: string,
    password?: string,
  ): Promise<{ initialPassword?: string }> {
    const generatedPassword = password ? undefined : generateInitialPassword();
    const newPassword = password ?? generatedPassword;
    const passwordHash = await bcrypt.hash(newPassword as string, BCRYPT_SALT_ROUNDS);

    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.passwordHash = passwordHash;
      account.needsPasswordUpdate = true;
      // A reset is also the unlock path for a locked account: failed attempts and lockout are
      // cleared so the user can actually sign in with the new password.
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      await repository.save(account);
    });

    return generatedPassword ? { initialPassword: generatedPassword } : {};
  }

  async assignRole(accountId: string, roleName: string, startDate?: Date, endDate?: Date): Promise<AccountRole> {
    const role = await this.dataSource.getRepository(Role).findOne({ where: { name: roleName } });
    if (!role) {
      throw new NotFoundException(`Unknown role: ${roleName}`);
    }
    if (!role.isActive) {
      throw new BadRequestException(`Role ${role.name} has been deactivated and cannot be assigned`);
    }

    // Same guards as createStaffAccount: a hospital tenant can never gain a cross-tenant role
    // or a role its package/provisioning didn't enable, and the platform tenant can never gain a
    // hospital role — otherwise the role picker and the API would disagree. Fail-open for
    // schema-only test tenants (no registry row).
    const tenantId = this.tenantContext.getTenantId();
    const isPlatformTenant = tenantId === resolvePlatformTenantId();
    if (role.isCrossTenant && !isPlatformTenant) {
      throw new BadRequestException(
        `Role ${role.name} is platform-only and cannot be assigned to a hospital tenant account`,
      );
    }
    if (!role.isCrossTenant && isPlatformTenant) {
      throw new BadRequestException(
        `Role ${role.name} is a hospital role and cannot be assigned to a platform operator account`,
      );
    }
    const registryRow: { hospitalId: string }[] = tenantId
      ? await this.dataSource.query(`SELECT "hospitalId" FROM tenants WHERE "hospitalId" = $1`, [
          tenantId,
        ])
      : [];
    if (registryRow.length > 0 && !isPlatformTenant) {
      const enabled: { roleId: string }[] = await this.dataSource.query(
        `SELECT "roleId" FROM tenant_roles WHERE "tenantId" = $1 AND "roleId" = $2`,
        [tenantId, role.id],
      );
      if (enabled.length === 0) {
        throw new BadRequestException(
          `Role ${role.name} is not enabled for this hospital. Enable it on the tenant page first.`,
        );
      }
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const account = await manager.getRepository(Account).findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }

      const repository = manager.getRepository(AccountRole);
      const existing = await repository.findOne({
        where: { accountId, roleId: role.id, isActive: true },
      });
      if (existing) {
        throw new ConflictException(`Account ${accountId} already holds an active assignment of role "${roleName}"`);
      }
      try {
        return await repository.save(
          repository.create({
            accountId,
            roleId: role.id,
            startDate: startDate ?? null,
            endDate: endDate ?? null,
          }),
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new ConflictException(`Account ${accountId} already holds an active assignment of role "${roleName}"`);
        }
        throw error;
      }
    });
  }

  async revokeRoleAssignment(accountId: string, accountRoleId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(AccountRole);
      const accountRole = await repository.findOne({ where: { id: accountRoleId, accountId } });
      if (!accountRole) {
        throw new NotFoundException(`Role assignment ${accountRoleId} not found for account ${accountId}`);
      }

      // Platform lockout guard: the platform tenant must always keep at least one Super Admin,
      // otherwise the whole platform console becomes unrecoverable (no operator can log in).
      if (this.tenantContext.getTenantId() === resolvePlatformTenantId() && accountRole.isActive) {
        const role = await this.dataSource.getRepository(Role).findOne({ where: { id: accountRole.roleId } });
        if (role?.isCrossTenant) {
          const remaining = await manager
            .getRepository(AccountRole)
            .count({ where: { roleId: role.id, isActive: true } });
          if (remaining <= 1) {
            throw new BadRequestException(
              'Cannot remove the last Super Admin from the platform tenant — there would be no operator left to administer the platform',
            );
          }
        }
      }

      accountRole.isActive = false;
      await repository.save(accountRole);
    });
  }
}
