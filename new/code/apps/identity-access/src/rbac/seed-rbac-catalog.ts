import { DataSource } from 'typeorm';
import { Role } from './entities/role.entity.js';

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

export async function seedRbacCatalog(dataSource: DataSource): Promise<void> {
  const repository = dataSource.getRepository(Role);
  for (const roleSeed of ROLE_CATALOG) {
    const existing = await repository.findOne({ where: { name: roleSeed.name } });
    if (existing) {
      continue;
    }
    await repository.save(repository.create(roleSeed));
  }
}
