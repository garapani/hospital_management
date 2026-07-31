import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { Ward } from '../master-data/entities/ward.entity.js';
import { CreateRbacCatalogTables } from './migrations/0001-create-rbac-catalog-tables.js';
import { AddRolePermissionsUniqueConstraint } from './migrations/0003-add-role-permissions-unique-constraint.js';
import { CreateTenantsTable } from './migrations/0005-create-tenants-table.js';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable],
    synchronize: false,
  });
}

export const dataSource = createDataSource();
