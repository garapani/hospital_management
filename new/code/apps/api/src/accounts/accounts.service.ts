import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import bcrypt from 'bcryptjs';
import { Account } from './entities/account.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

const BCRYPT_SALT_ROUNDS = 12;

export interface CreateStaffAccountInput {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roleName: string;
  needsPasswordUpdate?: boolean;
}

export interface AccountWithRoles {
  account: Account;
  roleIds: string[];
  roleNames: string[];
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createStaffAccount(input: CreateStaffAccountInput): Promise<Account> {
    const role = await this.dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: input.roleName } });
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const account = await manager.getRepository(Account).save(
        manager.getRepository(Account).create({
          accountType: 'staff',
          username: input.username,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          needsPasswordUpdate: input.needsPasswordUpdate ?? false,
        }),
      );
      await manager.getRepository(AccountRole).save(
        manager.getRepository(AccountRole).create({
          accountId: account.id,
          roleId: role.id,
        }),
      );
      return account;
    });
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

    return { account, roleIds, roleNames: roles.map((role) => role.name) };
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
    if (tenantId) {
      query
        .innerJoin('tenant_roles', 'tr', 'tr."roleId" = role.id')
        .where('tr."tenantId" = :tenantId', { tenantId });
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

  async assignRole(accountId: string, roleName: string, startDate?: Date, endDate?: Date): Promise<AccountRole> {
    const role = await this.dataSource.getRepository(Role).findOne({ where: { name: roleName } });
    if (!role) {
      throw new NotFoundException(`Unknown role: ${roleName}`);
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
      accountRole.isActive = false;
      await repository.save(accountRole);
    });
  }
}
