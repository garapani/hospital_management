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
    expect(roles.map((r: Role) => r.name).sort()).toEqual([...expectedNames].sort());
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
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
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
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name)).toEqual(['Super Admin']);
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
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });

  it('creates patient permissions and maps them to appropriate roles', async () => {
    await seedRbacCatalog(dataSource);

    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'patients.read' } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    const readRoles = await dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m: RolePermission) => m.roleId)) } });
    expect(readRoles.map((r: Role) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Nurse',
      'Receptionist / Front Desk',
    ]);

    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'patients.manage' } });
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const manageRoles = await dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m: RolePermission) => m.roleId)) } });
    expect(manageRoles.map((r: Role) => r.name)).toEqual(['Hospital Admin']);
  });

  it('creates the appointment.manage and appointment.read permissions', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps appointment permissions to correct roles', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Hospital Admin', 'Receptionist / Front Desk', 'Super Admin'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Receptionist / Front Desk', 'Super Admin'].sort());
  });

  it('creates the vitals.manage and vitals.read permissions', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps vitals permissions to correct roles', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.read' } });
    
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Hospital Admin', 'Nurse', 'Doctor', 'Super Admin'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Receptionist / Front Desk', 'Super Admin'].sort());
  });
  it('creates the encounter.manage and encounter.read permissions', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps encounter permissions to correct roles', async () => {
    await seedRbacCatalog(dataSource);
    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.manage' } });
    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.read' } });
    
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Super Admin', 'Doctor'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Super Admin', 'Hospital Admin', 'Doctor', 'Nurse'].sort());
  });

  it('creates triage permissions and maps them to appropriate roles', async () => {
    await seedRbacCatalog(dataSource);

    const readPerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'triage.read' } });
    const readMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    const readRoles = await dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m) => m.roleId)) } });
    expect(readRoles.map((r) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Nurse',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);

    const managePerm = await dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'triage.manage' } });
    const manageMappings = await dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const manageRoles = await dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m) => m.roleId)) } });
    expect(manageRoles.map((r) => r.name).sort()).toEqual(['Doctor', 'Nurse', 'Super Admin']);
  });
});
