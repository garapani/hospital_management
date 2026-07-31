import { In } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { seedRbacCatalog } from './seed-rbac-catalog.js';

describe('seedRbacCatalog (integration)', () => {
  const dataSource = createDataSource();

  const expectedNames = [
    'Super Admin',
    'Hospital Admin',
    'Receptionist / Front Desk',
    'Doctor',
    'Nurse',
    'Lab Technician',
    'Radiology Technician',
    'Pharmacist',
    'Billing/Accounts Staff',
    'Inventory/Store Manager',
    'HR/Payroll Admin',
    'Helpdesk Agent',
    'Auditor/Compliance',
    'Patient',
  ];

  beforeAll(async () => {
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('creates the fixed 14-role platform catalog', async () => {
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find({ where: { name: In(expectedNames) } });
    expect(roles).toHaveLength(14);
    expect(roles.map((r) => r.name).sort()).toEqual([...expectedNames].sort());
  });

  it('marks Super Admin as bypassing checks and cross-tenant', async () => {
    await seedRbacCatalog(dataSource);
    const superAdmin = await dataSource.getRepository(Role).findOneOrFail({
      where: { name: 'Super Admin' },
    });
    expect(superAdmin.bypassesPermissionChecks).toBe(true);
    expect(superAdmin.isCrossTenant).toBe(true);
  });

  it('is idempotent — running it twice does not duplicate roles', async () => {
    await seedRbacCatalog(dataSource);
    await seedRbacCatalog(dataSource);
    const roles = await dataSource.getRepository(Role).find({ where: { name: In(expectedNames) } });
    expect(roles).toHaveLength(14);
  });

  it('creates the identity.accounts.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps identity.accounts.manage to Hospital Admin and Super Admin only', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });

  it('creates the system-admin.tenants.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps system-admin.tenants.manage to Super Admin only, not Hospital Admin', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name)).toEqual(['Super Admin']);
  });

  it('creates the master-data.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps master-data.manage to Hospital Admin and Super Admin', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });
});
