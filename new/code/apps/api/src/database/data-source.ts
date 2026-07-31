import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { CreateRbacCatalogTables1738200000000 } from './migrations/1738200000000-create-rbac-catalog-tables.js';
import { AddRolePermissionsUniqueConstraint1738200000002 } from './migrations/1738200000002-add-role-permissions-unique-constraint.js';
import { CreateTenantsTable1738200000004 } from './migrations/1738200000004-create-tenants-table.js';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant],
    migrations: [
      CreateRbacCatalogTables1738200000000,
      AddRolePermissionsUniqueConstraint1738200000002,
      CreateTenantsTable1738200000004,
    ],
    synchronize: false,
  });
}

export const dataSource = createDataSource();
