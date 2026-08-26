import { DataSource } from 'typeorm';
import { Role } from './entities/role.entity.js';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';

interface RoleSeed {
  name: string;
  description: string;
  priority: number;
  isCrossTenant: boolean;
}

const ROLE_CATALOG: RoleSeed[] = [
  {
    name: 'Super Admin',
    description: 'Cross-hospital vendor/ops access to every service and tenant.',
    priority: 100,
    isCrossTenant: true,
  },
  {
    name: 'Hospital Admin',
    description: 'Full access within a single hospital tenant.',
    priority: 90,
    isCrossTenant: false,
  },
  {
    name: 'Receptionist / Front Desk',
    description: 'Patient registration, scheduling, and charge capture.',
    priority: 50,
    isCrossTenant: false,
  },
  {
    name: 'Doctor',
    description: 'Clinical documentation, ordering, and scheduling for own patients.',
    priority: 60,
    isCrossTenant: false,
  },
  {
    name: 'Nurse',
    description: 'Nursing tasks, vitals/MAR, and ward-scoped admission access.',
    priority: 55,
    isCrossTenant: false,
  },
  {
    name: 'Lab Technician',
    description: 'Lab test catalog, sample tracking, and results entry.',
    priority: 40,
    isCrossTenant: false,
  },
  {
    name: 'Radiology Technician',
    description: 'Imaging orders and DICOM report generation.',
    priority: 40,
    isCrossTenant: false,
  },
  {
    name: 'Pharmacist',
    description: 'Drug dispensing, sales, and rack/bin management.',
    priority: 40,
    isCrossTenant: false,
  },
  {
    name: 'Billing/Accounts Staff',
    description: 'Charge capture, invoicing, insurance, and accounting.',
    priority: 45,
    isCrossTenant: false,
  },
  {
    name: 'Inventory/Store Manager',
    description: 'Stock, goods receipt, and fixed-asset management.',
    priority: 40,
    isCrossTenant: false,
  },
  {
    name: 'HR/Payroll Admin',
    description: 'Employee records, payroll, and incentive calculation.',
    priority: 40,
    isCrossTenant: false,
  },
  {
    name: 'Helpdesk Agent',
    description: 'Internal ticketing.',
    priority: 20,
    isCrossTenant: false,
  },
  {
    name: 'Auditor/Compliance',
    description: 'Read-only access to audit trail and reporting.',
    priority: 30,
    isCrossTenant: false,
  },
  {
    name: 'Patient',
    description: 'Self-service portal access to own records only.',
    priority: 10,
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
    name: 'rbac.manage',
    description:
      'Create and list the global role catalog (platform-only — mapped to Super Admin only; hospital admins map roles to users via the tenant-scoped role picker instead).',
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
    name: 'patients.portal-invite',
    description: 'Issue a patient-portal login invite for an existing patient record',
  },
  {
    name: 'appointment.manage',
    description: 'Book, modify, and cancel appointments',
  },
  {
    name: 'appointment.read',
    description: 'View appointment schedules',
  },
  {
    name: 'vitals.manage',
    description: 'Create, update, and void patient vitals',
  },
  {
    name: 'vitals.read',
    description: 'View patient vitals',
  },
  {
    name: 'encounter.manage',
    description: 'Create and update clinical notes, diagnoses, and prescriptions',
  },
  {
    name: 'encounter.read',
    description: 'View clinical encounters',
  },
  {
    name: 'triage.manage',
    description: 'Manage the ER triage queue and entries',
  },
  {
    name: 'triage.read',
    description: 'View the ER triage queue and entries',
  },
  {
    name: 'admission.manage',
    description: 'Admit, transfer, and discharge inpatients',
  },
  {
    name: 'admission.read',
    description: 'View inpatient admissions',
  },
  {
    name: 'order.manage',
    description: 'Place orders and complete or cancel order items',
  },
  {
    name: 'order.read',
    description: 'View orders',
  },
  {
    name: 'billing.manage',
    description: 'Create invoices, record payments, cancel invoices, and manage deposits',
  },
  {
    name: 'reporting.read',
    description: 'View reporting events, dashboards, and aggregated metrics.',
  },
  {
    name: 'lab.catalog.manage',
    description: 'Create and list the lab test category/test/component catalog.',
  },
  {
    name: 'lab.read',
    description: 'View the lab catalog, requisitions, and results.',
  },
  {
    name: 'lab.requisition.create',
    description: 'Create a lab requisition from an order item.',
  },
  {
    name: 'lab.result.enter',
    description: 'Mark sample collection and enter lab result values.',
  },
  {
    name: 'lab.result.verify',
    description: 'Verify a fully-resulted lab requisition.',
  },
  {
    name: 'radiology.catalog.manage',
    description: 'Create and list the radiology imaging type/item catalog.',
  },
  {
    name: 'radiology.read',
    description: 'View the radiology catalog, requisitions, and reports.',
  },
  {
    name: 'radiology.requisition.create',
    description: 'Create a radiology requisition from an order item.',
  },
  {
    name: 'radiology.report.enter',
    description: 'Mark a study scanned and enter its report text.',
  },
  {
    name: 'radiology.report.verify',
    description: 'Verify a fully-reported radiology requisition.',
  },
  {
    name: 'inventory.catalog.manage',
    description: 'Create inventory item categories, sub-categories, items, and vendors',
  },
  {
    name: 'inventory.read',
    description:
      'Read inventory catalog (categories, sub-categories, items, vendors), purchase orders, and stock balance',
  },
  {
    name: 'inventory.purchase-order.create',
    description: 'Create a purchase order; also gates cancellation',
  },
  {
    name: 'inventory.goods-receipt.enter',
    description: 'Record a goods receipt against a purchase order line',
  },
  {
    name: 'inventory.requisition.create',
    description: 'Create a stock requisition; also gates cancellation',
  },
  {
    name: 'inventory.dispatch.fulfill',
    description: 'Fulfill a stock requisition line, decrementing stock balance',
  },
  {
    name: 'pharmacy.read',
    description: 'View pharmacy dispensing records',
  },
  {
    name: 'pharmacy.dispensing.create',
    description: 'Create a pharmacy dispensing record from an order item; also gates cancellation',
  },
  {
    name: 'pharmacy.dispensing.dispense',
    description: 'Dispense against a pharmacy dispensing record, decrementing stock',
  },
  {
    name: 'fixed-asset.read',
    description: 'View the fixed asset register and valuations',
  },
  {
    name: 'fixed-asset.manage',
    description: 'Create/update/deactivate fixed assets and categories',
  },
  {
    name: 'insurance.read',
    description: 'View insurance payers, patient policies, and claims',
  },
  {
    name: 'insurance.manage',
    description: 'Manage insurance payers, policies, and the claims lifecycle',
  },
  {
    name: 'accounting.read',
    description: 'View the chart of accounts, journal entries, and financial reports',
  },
  {
    name: 'accounting.manage',
    description: 'Manage accounts and journal entries',
  },
  {
    name: 'ward-supply.read',
    description: 'View ward sub-store stock balances and transactions',
  },
  {
    name: 'ward-supply.manage',
    description: 'Receive stock into and consume stock from a ward sub-store',
  },
  {
    name: 'nursing.read',
    description: 'View nursing tasks and medication administration records',
  },
  {
    name: 'nursing.manage',
    description: 'Manage nursing tasks and medication administration',
  },
  {
    name: 'ot.read',
    description: 'View the OT surgery schedule and records',
  },
  {
    name: 'ot.manage',
    description: 'Schedule and update OT surgeries',
  },
  {
    name: 'maternity.read',
    description: 'View maternity/labor records',
  },
  {
    name: 'maternity.manage',
    description: 'Manage maternity/labor records and record deliveries',
  },
  {
    name: 'cssd.read',
    description: 'View the sterile instrument catalog and sterilization cycles',
  },
  {
    name: 'cssd.manage',
    description: 'Manage instruments and sterilization cycles',
  },
  {
    name: 'employee.read',
    description: 'View the employee master',
  },
  {
    name: 'employee.manage',
    description: 'Manage the employee master',
  },
  {
    name: 'payroll.read',
    description: 'View payslips and payroll runs',
  },
  {
    name: 'payroll.manage',
    description: 'Generate and mark payslips paid',
  },
  {
    name: 'fraction.read',
    description: 'View fraction rules and entries',
  },
  {
    name: 'fraction.manage',
    description: 'Manage fraction rules and record entries',
  },
  {
    name: 'helpdesk.read',
    description: 'View helpdesk tickets',
  },
  {
    name: 'helpdesk.manage',
    description: 'Manage helpdesk tickets',
  },
  {
    name: 'marketing.read',
    description: 'View referral sources and patient referrals',
  },
  {
    name: 'marketing.manage',
    description: 'Manage referral sources and record patient referrals',
  },
  {
    name: 'ssu.read',
    description: 'View social service unit cases',
  },
  {
    name: 'ssu.manage',
    description: 'Manage social service unit cases',
  },
  {
    name: 'vaccination.read',
    description: 'View vaccination records',
  },
  {
    name: 'vaccination.manage',
    description: 'Record vaccinations',
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
  // Role-catalog management is platform-only: only the Super Admin may create/list roles.
  // Hospital admins map (assign) roles to users through the tenant-scoped /accounts/roles
  // picker instead — they never touch the shared role catalog.
  { roleName: 'Super Admin', permissionName: 'rbac.manage' },
  { roleName: 'Hospital Admin', permissionName: 'master-data.manage' },
  { roleName: 'Super Admin', permissionName: 'master-data.manage' },
  // Super Admin is mapped to every other module's permissions (appointment, vitals, encounter,
  // triage, admission, order, billing, lab, radiology, inventory, pharmacy, reporting); patients
  // was the one omission — seed-initial-setup already grants Super Admin ALL permissions (it is
  // the platform-ops role), so this closes the catalog/initial-setup inconsistency.
  { roleName: 'Super Admin', permissionName: 'patients.read' },
  { roleName: 'Super Admin', permissionName: 'patients.create' },
  { roleName: 'Super Admin', permissionName: 'patients.update' },
  { roleName: 'Super Admin', permissionName: 'patients.manage' },
  { roleName: 'Super Admin', permissionName: 'patients.portal-invite' },
  { roleName: 'Hospital Admin', permissionName: 'patients.read' },
  { roleName: 'Hospital Admin', permissionName: 'patients.create' },
  { roleName: 'Hospital Admin', permissionName: 'patients.update' },
  { roleName: 'Hospital Admin', permissionName: 'patients.manage' },
  { roleName: 'Hospital Admin', permissionName: 'patients.portal-invite' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.create' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.update' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'patients.portal-invite' },
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
  { roleName: 'Super Admin', permissionName: 'vitals.manage' },
  { roleName: 'Hospital Admin', permissionName: 'vitals.manage' },
  { roleName: 'Doctor', permissionName: 'vitals.manage' },
  { roleName: 'Nurse', permissionName: 'vitals.manage' },
  { roleName: 'Super Admin', permissionName: 'vitals.read' },
  { roleName: 'Hospital Admin', permissionName: 'vitals.read' },
  { roleName: 'Doctor', permissionName: 'vitals.read' },
  { roleName: 'Nurse', permissionName: 'vitals.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'vitals.read' },
  { roleName: 'Super Admin', permissionName: 'encounter.manage' },
  { roleName: 'Doctor', permissionName: 'encounter.manage' },
  { roleName: 'Super Admin', permissionName: 'encounter.read' },
  { roleName: 'Hospital Admin', permissionName: 'encounter.read' },
  { roleName: 'Doctor', permissionName: 'encounter.read' },
  { roleName: 'Nurse', permissionName: 'encounter.read' },
  { roleName: 'Super Admin', permissionName: 'triage.manage' },
  { roleName: 'Super Admin', permissionName: 'triage.read' },
  { roleName: 'Hospital Admin', permissionName: 'triage.read' },
  { roleName: 'Doctor', permissionName: 'triage.manage' },
  { roleName: 'Doctor', permissionName: 'triage.read' },
  { roleName: 'Nurse', permissionName: 'triage.manage' },
  { roleName: 'Nurse', permissionName: 'triage.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'triage.read' },
  { roleName: 'Super Admin', permissionName: 'admission.manage' },
  { roleName: 'Super Admin', permissionName: 'admission.read' },
  { roleName: 'Hospital Admin', permissionName: 'admission.manage' },
  { roleName: 'Hospital Admin', permissionName: 'admission.read' },
  { roleName: 'Doctor', permissionName: 'admission.manage' },
  { roleName: 'Doctor', permissionName: 'admission.read' },
  { roleName: 'Nurse', permissionName: 'admission.manage' },
  { roleName: 'Nurse', permissionName: 'admission.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'admission.read' },
  { roleName: 'Super Admin', permissionName: 'order.manage' },
  { roleName: 'Super Admin', permissionName: 'order.read' },
  { roleName: 'Hospital Admin', permissionName: 'order.manage' },
  { roleName: 'Hospital Admin', permissionName: 'order.read' },
  { roleName: 'Doctor', permissionName: 'order.manage' },
  { roleName: 'Doctor', permissionName: 'order.read' },
  { roleName: 'Nurse', permissionName: 'order.manage' },
  { roleName: 'Nurse', permissionName: 'order.read' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'order.read' },
  { roleName: 'Super Admin', permissionName: 'billing.manage' },
  { roleName: 'Hospital Admin', permissionName: 'billing.manage' },
  { roleName: 'Receptionist / Front Desk', permissionName: 'billing.manage' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'billing.manage' },
  { roleName: 'Super Admin', permissionName: 'reporting.read' },
  { roleName: 'Hospital Admin', permissionName: 'reporting.read' },
  { roleName: 'Auditor/Compliance', permissionName: 'reporting.read' },
  { roleName: 'Super Admin', permissionName: 'lab.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'lab.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'lab.read' },
  { roleName: 'Hospital Admin', permissionName: 'lab.read' },
  { roleName: 'Lab Technician', permissionName: 'lab.read' },
  { roleName: 'Doctor', permissionName: 'lab.read' },
  { roleName: 'Super Admin', permissionName: 'lab.requisition.create' },
  { roleName: 'Hospital Admin', permissionName: 'lab.requisition.create' },
  { roleName: 'Lab Technician', permissionName: 'lab.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'lab.result.enter' },
  { roleName: 'Hospital Admin', permissionName: 'lab.result.enter' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.enter' },
  { roleName: 'Super Admin', permissionName: 'lab.result.verify' },
  { roleName: 'Hospital Admin', permissionName: 'lab.result.verify' },
  { roleName: 'Lab Technician', permissionName: 'lab.result.verify' },
  { roleName: 'Super Admin', permissionName: 'radiology.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'radiology.read' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.read' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.read' },
  { roleName: 'Doctor', permissionName: 'radiology.read' },
  { roleName: 'Super Admin', permissionName: 'radiology.requisition.create' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.requisition.create' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'radiology.report.enter' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.report.enter' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.report.enter' },
  { roleName: 'Super Admin', permissionName: 'radiology.report.verify' },
  { roleName: 'Hospital Admin', permissionName: 'radiology.report.verify' },
  { roleName: 'Radiology Technician', permissionName: 'radiology.report.verify' },
  { roleName: 'Super Admin', permissionName: 'inventory.catalog.manage' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.catalog.manage' },
  { roleName: 'Super Admin', permissionName: 'inventory.read' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.read' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.read' },
  { roleName: 'Super Admin', permissionName: 'inventory.purchase-order.create' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.purchase-order.create' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.purchase-order.create' },
  { roleName: 'Super Admin', permissionName: 'inventory.goods-receipt.enter' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.goods-receipt.enter' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.goods-receipt.enter' },
  { roleName: 'Super Admin', permissionName: 'inventory.requisition.create' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.requisition.create' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.requisition.create' },
  { roleName: 'Super Admin', permissionName: 'inventory.dispatch.fulfill' },
  { roleName: 'Hospital Admin', permissionName: 'inventory.dispatch.fulfill' },
  { roleName: 'Inventory/Store Manager', permissionName: 'inventory.dispatch.fulfill' },
  { roleName: 'Super Admin', permissionName: 'pharmacy.read' },
  { roleName: 'Hospital Admin', permissionName: 'pharmacy.read' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.read' },
  { roleName: 'Doctor', permissionName: 'pharmacy.read' },
  { roleName: 'Super Admin', permissionName: 'pharmacy.dispensing.create' },
  { roleName: 'Hospital Admin', permissionName: 'pharmacy.dispensing.create' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.dispensing.create' },
  { roleName: 'Super Admin', permissionName: 'pharmacy.dispensing.dispense' },
  { roleName: 'Hospital Admin', permissionName: 'pharmacy.dispensing.dispense' },
  { roleName: 'Pharmacist', permissionName: 'pharmacy.dispensing.dispense' },
  { roleName: 'Super Admin', permissionName: 'fixed-asset.read' },
  { roleName: 'Super Admin', permissionName: 'fixed-asset.manage' },
  { roleName: 'Hospital Admin', permissionName: 'fixed-asset.read' },
  { roleName: 'Hospital Admin', permissionName: 'fixed-asset.manage' },
  { roleName: 'Inventory/Store Manager', permissionName: 'fixed-asset.read' },
  { roleName: 'Inventory/Store Manager', permissionName: 'fixed-asset.manage' },
  { roleName: 'Super Admin', permissionName: 'insurance.read' },
  { roleName: 'Super Admin', permissionName: 'insurance.manage' },
  { roleName: 'Hospital Admin', permissionName: 'insurance.read' },
  { roleName: 'Hospital Admin', permissionName: 'insurance.manage' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'insurance.read' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'insurance.manage' },
  { roleName: 'Super Admin', permissionName: 'accounting.read' },
  { roleName: 'Super Admin', permissionName: 'accounting.manage' },
  { roleName: 'Hospital Admin', permissionName: 'accounting.read' },
  { roleName: 'Hospital Admin', permissionName: 'accounting.manage' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'accounting.read' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'accounting.manage' },
  { roleName: 'Super Admin', permissionName: 'ward-supply.read' },
  { roleName: 'Super Admin', permissionName: 'ward-supply.manage' },
  { roleName: 'Hospital Admin', permissionName: 'ward-supply.read' },
  { roleName: 'Hospital Admin', permissionName: 'ward-supply.manage' },
  { roleName: 'Nurse', permissionName: 'ward-supply.read' },
  { roleName: 'Nurse', permissionName: 'ward-supply.manage' },
  { roleName: 'Super Admin', permissionName: 'nursing.read' },
  { roleName: 'Super Admin', permissionName: 'nursing.manage' },
  { roleName: 'Hospital Admin', permissionName: 'nursing.read' },
  { roleName: 'Hospital Admin', permissionName: 'nursing.manage' },
  { roleName: 'Nurse', permissionName: 'nursing.read' },
  { roleName: 'Nurse', permissionName: 'nursing.manage' },
  { roleName: 'Doctor', permissionName: 'nursing.read' },
  { roleName: 'Super Admin', permissionName: 'ot.read' },
  { roleName: 'Super Admin', permissionName: 'ot.manage' },
  { roleName: 'Hospital Admin', permissionName: 'ot.read' },
  { roleName: 'Hospital Admin', permissionName: 'ot.manage' },
  { roleName: 'Doctor', permissionName: 'ot.read' },
  { roleName: 'Doctor', permissionName: 'ot.manage' },
  { roleName: 'Nurse', permissionName: 'ot.read' },
  { roleName: 'Nurse', permissionName: 'ot.manage' },
  { roleName: 'Super Admin', permissionName: 'maternity.read' },
  { roleName: 'Super Admin', permissionName: 'maternity.manage' },
  { roleName: 'Hospital Admin', permissionName: 'maternity.read' },
  { roleName: 'Hospital Admin', permissionName: 'maternity.manage' },
  { roleName: 'Doctor', permissionName: 'maternity.read' },
  { roleName: 'Doctor', permissionName: 'maternity.manage' },
  { roleName: 'Nurse', permissionName: 'maternity.read' },
  { roleName: 'Nurse', permissionName: 'maternity.manage' },
  { roleName: 'Super Admin', permissionName: 'cssd.read' },
  { roleName: 'Super Admin', permissionName: 'cssd.manage' },
  { roleName: 'Hospital Admin', permissionName: 'cssd.read' },
  { roleName: 'Hospital Admin', permissionName: 'cssd.manage' },
  { roleName: 'Nurse', permissionName: 'cssd.read' },
  { roleName: 'Nurse', permissionName: 'cssd.manage' },
  { roleName: 'Super Admin', permissionName: 'employee.read' },
  { roleName: 'Super Admin', permissionName: 'employee.manage' },
  { roleName: 'Hospital Admin', permissionName: 'employee.read' },
  { roleName: 'Hospital Admin', permissionName: 'employee.manage' },
  { roleName: 'HR/Payroll Admin', permissionName: 'employee.read' },
  { roleName: 'HR/Payroll Admin', permissionName: 'employee.manage' },
  { roleName: 'Super Admin', permissionName: 'payroll.read' },
  { roleName: 'Super Admin', permissionName: 'payroll.manage' },
  { roleName: 'Hospital Admin', permissionName: 'payroll.read' },
  { roleName: 'Hospital Admin', permissionName: 'payroll.manage' },
  { roleName: 'HR/Payroll Admin', permissionName: 'payroll.read' },
  { roleName: 'HR/Payroll Admin', permissionName: 'payroll.manage' },
  { roleName: 'Super Admin', permissionName: 'fraction.read' },
  { roleName: 'Super Admin', permissionName: 'fraction.manage' },
  { roleName: 'Hospital Admin', permissionName: 'fraction.read' },
  { roleName: 'Hospital Admin', permissionName: 'fraction.manage' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'fraction.read' },
  { roleName: 'Billing/Accounts Staff', permissionName: 'fraction.manage' },
  { roleName: 'Super Admin', permissionName: 'helpdesk.read' },
  { roleName: 'Super Admin', permissionName: 'helpdesk.manage' },
  { roleName: 'Hospital Admin', permissionName: 'helpdesk.read' },
  { roleName: 'Hospital Admin', permissionName: 'helpdesk.manage' },
  { roleName: 'Helpdesk Agent', permissionName: 'helpdesk.read' },
  { roleName: 'Helpdesk Agent', permissionName: 'helpdesk.manage' },
  { roleName: 'Super Admin', permissionName: 'marketing.read' },
  { roleName: 'Super Admin', permissionName: 'marketing.manage' },
  { roleName: 'Hospital Admin', permissionName: 'marketing.read' },
  { roleName: 'Hospital Admin', permissionName: 'marketing.manage' },
  { roleName: 'Super Admin', permissionName: 'ssu.read' },
  { roleName: 'Super Admin', permissionName: 'ssu.manage' },
  { roleName: 'Hospital Admin', permissionName: 'ssu.read' },
  { roleName: 'Hospital Admin', permissionName: 'ssu.manage' },
  { roleName: 'Super Admin', permissionName: 'vaccination.read' },
  { roleName: 'Super Admin', permissionName: 'vaccination.manage' },
  { roleName: 'Hospital Admin', permissionName: 'vaccination.read' },
  { roleName: 'Hospital Admin', permissionName: 'vaccination.manage' },
  { roleName: 'Doctor', permissionName: 'vaccination.read' },
  { roleName: 'Doctor', permissionName: 'vaccination.manage' },
  { roleName: 'Nurse', permissionName: 'vaccination.read' },
  { roleName: 'Nurse', permissionName: 'vaccination.manage' },
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
