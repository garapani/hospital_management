import { DataSource } from 'typeorm';

/**
 * SaaS packages: the tiering chosen at tenant creation (public-schema catalog, like
 * roles/permissions; `tenants.packageCode` records each tenant's tier). Idempotent, upsert-based
 * seeder — the data that used to live in migration 0048, moved out of migrations so catalog
 * changes are seed edits, not new migrations (Development-Standards.md §108).
 *
 * Package gating is resolution-time: a tenant's JWTs only carry permissions whose modules are in
 * its package (PackagesService.filterPermissions at login/refresh). No data is hidden or
 * partitioned — schema stays uniform, access is just granted/revoked.
 *
 * Run it wherever the platform catalog must exist: the test harness seeds it with the tenant
 * context, `seed-all` runs it after `seed-rbac` and before `seed-initial-setup` (admin seeding
 * inserts accounts whose tenants reference packageCode), and a fresh platform deploy runs it
 * before first tenant creation.
 */
const PACKAGES = [
  {
    code: 'basic',
    name: 'Basic',
    description:
      'Small hospitals: registration, visits, billing, lab, radiology, pharmacy, inventory, employees, payroll and core reporting.',
    modules: [
      'patients', 'appointments', 'admissions', 'billing', 'orders', 'clinical', 'lab',
      'radiology', 'pharmacy', 'inventory', 'employee', 'payroll', 'notifications', 'reporting',
    ],
  },
  {
    code: 'standard',
    name: 'Standard',
    description:
      'Medium hospitals: Basic plus ward supply, nursing, OT, maternity, CSSD, vaccination, fixed assets, helpdesk, marketing, SSU and doctor fraction.',
    modules: [
      'patients', 'appointments', 'admissions', 'billing', 'orders', 'clinical', 'lab',
      'radiology', 'pharmacy', 'inventory', 'employee', 'payroll', 'notifications', 'reporting',
      'ward-supply', 'nursing', 'ot', 'maternity', 'cssd', 'vaccination', 'fixed-assets',
      'helpdesk', 'marketing', 'ssu', 'fraction',
    ],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'Large hospitals: Standard plus insurance & claims, accounting, and the full Document & Print scope.',
    modules: [
      'patients', 'appointments', 'admissions', 'billing', 'orders', 'clinical', 'lab',
      'radiology', 'pharmacy', 'inventory', 'employee', 'payroll', 'notifications', 'reporting',
      'ward-supply', 'nursing', 'ot', 'maternity', 'cssd', 'vaccination', 'fixed-assets',
      'helpdesk', 'marketing', 'ssu', 'fraction', 'insurance', 'accounting', 'document-print',
    ],
  },
];

export async function seedPackagesCatalog(dataSource: DataSource): Promise<void> {
  for (const pkg of PACKAGES) {
    await dataSource.query(
      `INSERT INTO packages (code, name, description, modules)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         modules = EXCLUDED.modules`,
      [pkg.code, pkg.name, pkg.description, JSON.stringify(pkg.modules)],
    );
  }
}
