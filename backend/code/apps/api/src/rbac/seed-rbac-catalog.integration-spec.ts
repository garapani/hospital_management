import { In } from 'typeorm';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
import { seedRbacCatalog } from './seed-rbac-catalog.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('seedRbacCatalog (integration)', () => {
  let ctx: TenantTestContext;

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
    ctx = await setupTenantTestContext({ namePrefix: 'seed_rbac_catalog' });
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('creates the fixed 14-role platform catalog', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const roles = await ctx.dataSource.getRepository(Role).find({ where: { name: In(expectedNames) } });
    expect(roles).toHaveLength(14);
    expect(roles.map((r: Role) => r.name).sort()).toEqual([...expectedNames].sort());
  });

  it('marks Super Admin as cross-tenant', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const superAdmin = await ctx.dataSource.getRepository(Role).findOneOrFail({
      where: { name: 'Super Admin' },
    });
    expect(superAdmin.isCrossTenant).toBe(true);
  });

  it('is idempotent — running it twice does not duplicate roles', async () => {
    await seedRbacCatalog(ctx.dataSource);
    await seedRbacCatalog(ctx.dataSource);
    const roles = await ctx.dataSource.getRepository(Role).find({ where: { name: In(expectedNames) } });
    expect(roles).toHaveLength(14);
  });

  it('creates the identity.accounts.manage permission', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps identity.accounts.manage to Hospital Admin and Super Admin only', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });

  it('creates the system-admin.tenants.manage permission', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps system-admin.tenants.manage to Super Admin only, not Hospital Admin', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'system-admin.tenants.manage' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name)).toEqual(['Super Admin']);
  });

  it('creates the master-data.manage permission', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps master-data.manage to Hospital Admin and Super Admin', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.manage' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    expect(roles.map((r: Role) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });

  it('grants master-data.read to every staff role that works the department/ward/bed layout, including Receptionist', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'master-data.read' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m: RolePermission) => m.roleId)) },
    });
    const roleNames = roles.map((r: Role) => r.name).sort();
    // The front desk books appointments, registers patients and admits them — a Receptionist
    // without master-data.read 403s on the department/ward/bed lookups those screens need
    // (regression guard for the 2026-08-30 module-pass fix).
    expect(roleNames).toEqual(
      [
        'Billing/Accounts Staff',
        'Doctor',
        'Hospital Admin',
        'Inventory/Store Manager',
        'Nurse',
        'Receptionist / Front Desk',
        'Super Admin',
      ].sort(),
    );
  });

  it('creates patient permissions and maps them to appropriate roles', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'patients.read' } });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    const readRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m: RolePermission) => m.roleId)) } });
    expect(readRoles.map((r: Role) => r.name).sort()).toEqual([
      'Billing/Accounts Staff',
      'Doctor',
      'Hospital Admin',
      'Lab Technician',
      'Nurse',
      'Radiology Technician',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);

    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'patients.manage' } });
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const manageRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m: RolePermission) => m.roleId)) } });
    expect(manageRoles.map((r: Role) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });

  it('creates the appointment.manage and appointment.read permissions', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps appointment permissions to correct roles', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'appointment.read' } });
    
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await ctx.dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Hospital Admin', 'Receptionist / Front Desk', 'Super Admin'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Receptionist / Front Desk', 'Super Admin'].sort());
  });

  it('creates the vitals.manage and vitals.read permissions', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps vitals permissions to correct roles', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'vitals.read' } });
    
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await ctx.dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Hospital Admin', 'Nurse', 'Doctor', 'Super Admin'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Receptionist / Front Desk', 'Super Admin'].sort());
  });
  it('creates the encounter.manage and encounter.read permissions', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.read' } });
    expect(managePerm.isActive).toBe(true);
    expect(readPerm.isActive).toBe(true);
  });

  it('maps encounter permissions to correct roles', async () => {
    await seedRbacCatalog(ctx.dataSource);
    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.manage' } });
    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'encounter.read' } });
    
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    
    const roles = await ctx.dataSource.getRepository(Role).find();
    
    const manageRoleNames = manageMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(manageRoleNames.sort()).toEqual(['Super Admin', 'Doctor'].sort());
    
    const readRoleNames = readMappings.map((m: RolePermission) => roles.find((r: Role) => r.id === m.roleId)!.name);
    expect(readRoleNames.sort()).toEqual(['Super Admin', 'Hospital Admin', 'Doctor', 'Nurse'].sort());
  });

  it('creates triage permissions and maps them to appropriate roles', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const readPerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'triage.read' } });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: readPerm.id } });
    const readRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m) => m.roleId)) } });
    expect(readRoles.map((r) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Nurse',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);

    const managePerm = await ctx.dataSource.getRepository(Permission).findOneOrFail({ where: { name: 'triage.manage' } });
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({ where: { permissionId: managePerm.id } });
    const manageRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m) => m.roleId)) } });
    expect(manageRoles.map((r) => r.name).sort()).toEqual(['Doctor', 'Nurse', 'Super Admin']);
  });

  it('maps admission.manage to Doctor, Nurse, Hospital Admin, Super Admin and admission.read additionally to Receptionist', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const managePermission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'admission.manage' },
    });
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: managePermission.id },
    });
    const manageRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m) => m.roleId)) } });
    expect(manageRoles.map((r) => r.name).sort()).toEqual(['Doctor', 'Hospital Admin', 'Nurse', 'Super Admin']);

    const readPermission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'admission.read' },
    });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: readPermission.id },
    });
    const readRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m) => m.roleId)) } });
    expect(readRoles.map((r) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Nurse',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);
  });

  // PRD §6.1: Nurse gets full access to Nursing/Clinical-EMR/Admission/Ward Supply but only
  // read-only on Order — order.manage stays with Doctor/Hospital Admin/Super Admin only.
  // Pharmacist's own secondary scope is "Inventory, Order" (read) alongside primary Pharmacy
  // rights — added to close the pharmacy P2 in code-review-findings-2026-08-25.md.
  it('maps order.manage to Doctor, Hospital Admin, Super Admin (not Nurse — PRD §6.1 read-only) and order.read additionally to Receptionist, Nurse and Pharmacist', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const managePermission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'order.manage' },
    });
    const manageMappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: managePermission.id },
    });
    const manageRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(manageMappings.map((m) => m.roleId)) } });
    expect(manageRoles.map((r) => r.name).sort()).toEqual(['Doctor', 'Hospital Admin', 'Super Admin']);

    const readPermission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'order.read' },
    });
    const readMappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: readPermission.id },
    });
    const readRoles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(readMappings.map((m) => m.roleId)) } });
    expect(readRoles.map((r) => r.name).sort()).toEqual([
      'Doctor',
      'Hospital Admin',
      'Lab Technician',
      'Nurse',
      'Pharmacist',
      'Radiology Technician',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);
  });

  // Regression test for code-review-findings-2026-08-25.md's pharmacy P2: Pharmacist was missing
  // both halves of its PRD §6.1 "Inventory, Order" secondary read scope.
  it('grants Pharmacist inventory.read', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'inventory.read' },
    });
    const mapping = await ctx.dataSource.getRepository(RolePermission).findOne({
      where: { permissionId: permission.id, roleId: (await ctx.dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Pharmacist' } })).id },
    });
    expect(mapping).not.toBeNull();
  });

  it('maps billing.manage to Receptionist / Front Desk, Billing/Accounts Staff, Hospital Admin, Super Admin', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'billing.manage' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(mappings.map((m) => m.roleId)) } });
    expect(roles.map((r) => r.name).sort()).toEqual([
      'Billing/Accounts Staff',
      'Hospital Admin',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);
  });

  // Regression test for code-review-findings-2026-08-25.md's billing P2: billing.manage was the
  // only billing permission, so front desk could issue refunds and auditors couldn't view
  // invoices. billing.read now exists separately, additionally granted to Auditor/Compliance.
  it('maps billing.read to the billing.manage roles plus Auditor/Compliance', async () => {
    await seedRbacCatalog(ctx.dataSource);

    const permission = await ctx.dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'billing.read' },
    });
    const mappings = await ctx.dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await ctx.dataSource.getRepository(Role).find({ where: { id: In(mappings.map((m) => m.roleId)) } });
    expect(roles.map((r) => r.name).sort()).toEqual([
      'Auditor/Compliance',
      'Billing/Accounts Staff',
      'Hospital Admin',
      'Receptionist / Front Desk',
      'Super Admin',
    ]);
  });

  // Regression test for the P1 in code-review-findings-2026-08-25.md: Hospital Admin's seed was
  // missing the Lab/Radiology workflow permissions, all Pharmacy permissions, and several
  // Inventory permissions, despite its description claiming "full access within a single hospital
  // tenant" — and `bypassesPermissionChecks` (now removed) never covered the gap since
  // PermissionGuard never read it.
  it.each([
    'lab.requisition.create',
    'lab.result.enter',
    'lab.result.verify',
    'radiology.requisition.create',
    'radiology.report.enter',
    'radiology.report.verify',
    'pharmacy.read',
    'pharmacy.dispensing.create',
    'pharmacy.dispensing.dispense',
    'inventory.purchase-order.create',
    'inventory.goods-receipt.enter',
    'inventory.requisition.create',
    'inventory.dispatch.fulfill',
  ])('maps %s to Hospital Admin', async (permissionName) => {
    await seedRbacCatalog(ctx.dataSource);
    const permission = await ctx.dataSource
      .getRepository(Permission)
      .findOneOrFail({ where: { name: permissionName } });
    const hospitalAdmin = await ctx.dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: 'Hospital Admin' } });
    const mapping = await ctx.dataSource.getRepository(RolePermission).findOne({
      where: { permissionId: permission.id, roleId: hospitalAdmin.id },
    });
    expect(mapping).not.toBeNull();
  });
});
