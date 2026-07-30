import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { DataSource, In } from 'typeorm';
import { Account } from './entities/account.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import { Role } from '../rbac/entities/role.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { CreateTenantAccountTables1738200000001 } from '../database/migrations/1738200000001-create-tenant-account-tables.js';

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;
const BCRYPT_SALT_ROUNDS = 12;

export interface CreateStaffAccountInput {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roleName: string;
}

export interface AccountWithRoles {
  account: Account;
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

    const accountRoles = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(AccountRole).find({ where: { accountId: account.id, isActive: true } }),
    );
    const roleIds = accountRoles.map((accountRole) => accountRole.roleId);
    const roles =
      roleIds.length === 0
        ? []
        : await this.dataSource.getRepository(Role).find({ where: { id: In(roleIds) } });

    return { account, roleNames: roles.map((role) => role.name) };
  }
}
