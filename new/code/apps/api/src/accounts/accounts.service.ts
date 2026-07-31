import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DataSource, In } from 'typeorm';
import { Account } from './entities/account.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreateTenantAccountTables1738200000001 } from '../database/migrations/accounts/1738200000001-create-tenant-account-tables.js';
import { AddAccountRolesUniqueActiveAssignment1738200000003 } from '../database/migrations/accounts/1738200000003-add-account-roles-unique-active-assignment.js';
import { CreateAuditRecordsTable1738200000005 } from '../database/migrations/audit/1738200000005-create-audit-records-table.js';
import { CreateMasterDataTables1738200000006 } from '../database/migrations/master-data/1738200000006-create-master-data-tables.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;
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
  ) {}

  /**
   * Test/dev-only stand-in for the deferred `tenant.provisioned` event consumer:
   * creates the tenant schema and runs the account-tables migration against it directly.
   */
  async provisionTenantSchema(dataSource: DataSource, tenantId: string): Promise<void> {
    if (!SAFE_TENANT_ID.test(tenantId)) {
      throw new Error(`Refusing to provision unsafe tenant id: ${tenantId}`);
    }
    const schemaName = `tenant_${tenantId}`;
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
      await queryRunner.query(`SET search_path TO "${schemaName}", public`);
      const migration = new CreateTenantAccountTables1738200000001();
      await migration.up(queryRunner);
      const uniqueActiveAssignmentMigration = new AddAccountRolesUniqueActiveAssignment1738200000003();
      await uniqueActiveAssignmentMigration.up(queryRunner);
      const auditRecordsMigration = new CreateAuditRecordsTable1738200000005();
      await auditRecordsMigration.up(queryRunner);
      const masterDataMigration = new CreateMasterDataTables1738200000006();
      await masterDataMigration.up(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

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
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(Account)
        .increment({ id: accountId }, 'failedLoginAttempts', 1),
    );
  }

  async lockAccount(accountId: string, lockedUntil: Date): Promise<void> {
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).update({ id: accountId }, { lockedUntil }),
    );
  }

  async resetFailedLogins(accountId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(Account)
        .update({ id: accountId }, { failedLoginAttempts: 0, lockedUntil: null }),
    );
  }

  async listAccounts(limit: number, offset: number): Promise<Account[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).find({ take: limit, skip: offset, order: { createdAt: 'ASC' } }),
    );
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
