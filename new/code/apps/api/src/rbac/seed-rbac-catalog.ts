import { DataSource } from 'typeorm';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';

interface RoleSeed {
  name: string;
  description: string;
  priority: number;
  bypassesPermissionChecks: boolean;
  isCrossTenant: boolean;
}

const ROLE_CATALOG: RoleSeed[] = [
  {
    name: 'Super Admin',
    description: 'Cross-hospital vendor/ops access to every service and tenant.',
    priority: 100,
    bypassesPermissionChecks: true,
    isCrossTenant: true,
  },
  {
    name: 'Hospital Admin',
    description: 'Full access within a single hospital tenant.',
    priority: 90,
    bypassesPermissionChecks: true,
    isCrossTenant: false,
  },
  {
    name: 'Receptionist / Front Desk',
    description: 'Patient registration, scheduling, and charge capture.',
    priority: 50,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Doctor',
    description: 'Clinical documentation, ordering, and scheduling for own patients.',
    priority: 60,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Nurse',
    description: 'Nursing tasks, vitals/MAR, and ward-scoped admission access.',
    priority: 55,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Lab Technician',
    description: 'Lab test catalog, sample tracking, and results entry.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Radiology Technician',
    description: 'Imaging orders and DICOM report generation.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Pharmacist',
    description: 'Drug dispensing, sales, and rack/bin management.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Billing/Accounts Staff',
    description: 'Charge capture, invoicing, insurance, and accounting.',
    priority: 45,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Inventory/Store Manager',
    description: 'Stock, goods receipt, and fixed-asset management.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'HR/Payroll Admin',
    description: 'Employee records, payroll, and incentive calculation.',
    priority: 40,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Helpdesk Agent',
    description: 'Internal ticketing.',
    priority: 20,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Auditor/Compliance',
    description: 'Read-only access to audit trail and reporting.',
    priority: 30,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
  {
    name: 'Patient',
    description: 'Self-service portal access to own records only.',
    priority: 10,
    bypassesPermissionChecks: false,
    isCrossTenant: false,
  },
];

interface PermissionSeed {
  name: string;
  description: string;
}

const PERMISSION_CATALOG: PermissionSeed[] = [
  {
    name: 'identity.accounts.manage',
    description: 'Create, list, deactivate, unlock accounts and manage role assignments.',
  },
  {
    name: 'system-admin.tenants.manage',
    description: 'Provision, list, view, suspend, and reactivate hospital tenants.',
  },
  {
    name: 'master-data.manage',
    description: 'Create, list, deactivate, and reactivate departments and wards.',
  },
  {
    name: 'patients.read',
    description: 'Read patient master records and search catalog',
  },
  {
    name: 'patients.create',
    description: 'Register new patient records',
  },
  {
    name: 'patients.update',
    description: 'Update patient demographics and details',
  },
  {
    name: 'patients.manage',
    description: 'Deactivate and manage patient records',
  },
  {
    name: 'appointment.manage',
    description: 'Book, modify, and cancel appointments',
  },
  {
    name: 'appointment.read',
    description: 'View appointment schedules',
  },
];

interface RolePermissionMapping {
  roleName: string;
  permissionName: string;
}

const ROLE_PERMISSION_MAPPINGS: RolePermissionMapping[] = [
  { roleName: 'Hospital Admin', permissionName: 'identity.accounts.manage' },
  { roleName: 'Super Admin', permissionName: 'identity.accounts.manage' },
  { roleName: 'Super Admin', permissionName: 'system-admin.tenants.manage' },
  { roleName: 'Hospital Admin', permissionName: 'master-data.manage' },
  { roleName: 'Super Admin', permissionName: 'master-data.manage' },
  { roleName: 'Hospital Admin', permissionName: 'patients.read' },
  { roleName: 'Hospital Admin', permissionName: 'patients.create' },
  { roleName: 'Hospital Admin', permissionName: 'patients.update' },
  { roleName: 'Hospital Admin', permissionName: 'patients.manage' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.create' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.update' },
  { roleName: 'Doctor', permissionName: 'patients.read' },
  { roleName: 'Doctor', permissionName: 'patients.create' },
  { roleName: 'Doctor', permissionName: 'patients.update' },
  { roleName: 'Nurse', permissionName: 'patients.read' },
  { roleName: 'Nurse', permissionName: 'patients.create' },
  { roleName: 'Nurse', permissionName: 'patients.update' },
  { roleName: 'Super Admin', permissionName: 'appointment.manage' },
  { roleName: 'Super Admin', permissionName: 'appointment.read' },
  { roleName: 'Hospital Admin', permissionName: 'appointment.manage' },
  { roleName: 'Hospital Admin', permissionName: 'appointment.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'appointment.manage' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'appointment.read' },
  { roleName: 'Doctor', permissionName: 'appointment.read' },
  { roleName: 'Nurse', permissionName: 'appointment.read' },
];

export async function seedRbacCatalog(dataSource: DataSource): Promise<void> {
  const roleRepository = dataSource.getRepository(Role);
  for (const roleSeed of ROLE_CATALOG) {
    await roleRepository.createQueryBuilder().insert().into(Role).values(roleSeed).orIgnore().execute();
  }

  const permissionRepository = dataSource.getRepository(Permission);
  for (const permissionSeed of PERMISSION_CATALOG) {
    await permissionRepository
      .createQueryBuilder()
      .insert()
      .into(Permission)
      .values(permissionSeed)
      .orIgnore()
      .execute();
  }

  const rolePermissionRepository = dataSource.getRepository(RolePermission);
  for (const mapping of ROLE_PERMISSION_MAPPINGS) {
    const role = await roleRepository.findOneOrFail({ where: { name: mapping.roleName } });
    const permission = await permissionRepository.findOneOrFail({ where: { name: mapping.permissionName } });
    await rolePermissionRepository
      .createQueryBuilder()
      .insert()
      .into(RolePermission)
      .values({ roleId: role.id, permissionId: permission.id })
      .orIgnore()
      .execute();
  }
}
