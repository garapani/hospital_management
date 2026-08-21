/**
 * SaaS package catalog — the tiering sold at tenant creation. A package is a curated set of
 * module keys; a module's permissions are only granted to a tenant's JWTs when that module is in
 * the tenant's package (see PackagesService.filterPermissions). Schema stays uniform across
 * tenants — packages gate *access*, not data.
 *
 * Tiering (agreed with the product owner, 2026-08-21):
 *  - Basic (small hospitals — the MVP launch tier): registration → visit → bill → lab/radiology/
 *    pharmacy, plus employee/payroll and core reporting.
 *  - Standard (medium hospitals): Basic plus ward/nursing/OT/maternity/CSSD/vaccination,
 *    fixed assets, helpdesk, marketing, SSU and doctor fraction.
 *  - Enterprise (large hospitals): Standard plus insurance & claims, accounting, and the full
 *    Document & Print scope (report PDF export already lives inside lab/radiology).
 */
export interface PackageDefinition {
  code: string;
  name: string;
  description: string;
  modules: string[];
  /**
   * Catalog roles enabled for a tenant of this package at provisioning time (and added on a
   * package change). 'Super Admin' is deliberately never included — it is a cross-tenant ops
   * role for the platform tenant, not a customer role. Roles not named here can still be
   * switched on manually via the platform console's per-tenant role toggles; the package only
   * decides the sensible defaults.
   */
  defaultRoleNames: string[];
}

const BASIC_ROLES = [
  'Hospital Admin',
  'Receptionist / Front Desk',
  'Doctor',
  'Nurse',
  'Lab Technician',
  'Radiology Technician',
  'Pharmacist',
  'Inventory/Store Manager',
  'Billing/Accounts Staff',
  'HR/Payroll Admin',
  'Auditor/Compliance',
];

const BASIC_MODULES = [
  'patients',
  'appointments',
  'admissions',
  'billing',
  'orders',
  'clinical', // vitals + encounters + triage
  'lab',
  'radiology',
  'pharmacy',
  'inventory',
  'employee',
  'payroll',
  'notifications',
  'reporting',
];

const STANDARD_MODULES = [
  ...BASIC_MODULES,
  'ward-supply',
  'nursing',
  'ot',
  'maternity',
  'cssd',
  'vaccination',
  'fixed-assets',
  'helpdesk',
  'marketing',
  'ssu',
  'fraction',
];

const ENTERPRISE_MODULES = [
  ...STANDARD_MODULES,
  'insurance',
  'accounting',
  // Document & Print is Enterprise-scoped; it currently has no permission-bearing module of its
  // own (report PDF export lives inside lab/radiology), so this entry is forward-looking.
  'document-print',
];

export const PACKAGE_CATALOG: PackageDefinition[] = [
  {
    code: 'basic',
    name: 'Basic',
    description:
      'Small hospitals: registration, visits, billing, lab, radiology, pharmacy, inventory, employees, payroll and core reporting.',
    modules: BASIC_MODULES,
    defaultRoleNames: BASIC_ROLES,
  },
  {
    code: 'standard',
    name: 'Standard',
    description:
      'Medium hospitals: Basic plus ward supply, nursing, OT, maternity, CSSD, vaccination, fixed assets, helpdesk, marketing, SSU and doctor fraction.',
    modules: STANDARD_MODULES,
    defaultRoleNames: [...BASIC_ROLES, 'Helpdesk Agent'],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'Large hospitals: Standard plus insurance & claims, accounting, and the full Document & Print scope.',
    modules: ENTERPRISE_MODULES,
    defaultRoleNames: [...BASIC_ROLES, 'Helpdesk Agent', 'Patient'],
  },
];

/**
 * The permission-name prefixes owned by each module key. Prefixes are the catalog permission
 * names' leading segments (e.g. module `appointments` owns `appointment.read`/`appointment.manage`).
 * A module key with no mapping (or no permissions in the catalog, e.g. notifications) contributes
 * nothing to filtering — such modules are effectively always-on.
 */
export const MODULE_PERMISSION_PREFIXES: Record<string, string[]> = {
  patients: ['patients'],
  appointments: ['appointment'],
  admissions: ['admission'],
  billing: ['billing'],
  orders: ['order'],
  clinical: ['vitals', 'encounter', 'triage'],
  lab: ['lab'],
  radiology: ['radiology'],
  inventory: ['inventory'],
  pharmacy: ['pharmacy'],
  employee: ['employee'],
  payroll: ['payroll'],
  notifications: ['notification'],
  reporting: ['reporting'],
  'ward-supply': ['ward-supply'],
  nursing: ['nursing'],
  ot: ['ot'],
  maternity: ['maternity'],
  cssd: ['cssd'],
  vaccination: ['vaccination'],
  'fixed-assets': ['fixed-asset'],
  helpdesk: ['helpdesk'],
  marketing: ['marketing'],
  ssu: ['ssu'],
  fraction: ['fraction'],
  insurance: ['insurance'],
  accounting: ['accounting'],
};

/**
 * Permission prefixes that stay granted in every package — user accounts, platform tenant
 * administration, and master data (departments/wards) are core infrastructure, not tiered
 * features.
 */
export const ALWAYS_ON_PERMISSION_PREFIXES = [
  'identity', // identity.accounts.manage
  'system-admin', // system-admin.tenants.manage
  'master-data', // master-data.manage
  'users', // users.all.read (legacy essential permission)
  'system', // system.config.manage (legacy essential permission)
];

/** Whether a catalog permission is granted to a tenant whose package enables `modules`. */
export function permissionAllowed(permission: string, modules: string[]): boolean {
  if (
    ALWAYS_ON_PERMISSION_PREFIXES.some(
      (prefix) => permission === prefix || permission.startsWith(`${prefix}.`),
    )
  ) {
    return true;
  }
  const allowedPrefixes = modules.flatMap((moduleKey) => MODULE_PERMISSION_PREFIXES[moduleKey] ?? []);
  return allowedPrefixes.some(
    (prefix) => permission === prefix || permission.startsWith(`${prefix}.`),
  );
}
