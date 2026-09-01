import { InitialPlatformSchema1000000000093 } from './0093-initial-platform-schema.js';
import { InitialTenantSchema2000000000094 } from './0094-initial-tenant-schema.js';
import { AddPatientAllergies3000000000001 } from './0095-add-patient-allergies.js';
import { AddAccountWard3000000000002 } from './0096-add-account-ward.js';
import { AddPatientInsuranceInfo3000000000003 } from './0097-add-patient-insurance-info.js';

// Platform-level migrations: create shared/public-schema tables (RBAC catalog, tenant registry).
// Run once by migrate.ts. Never replayed per-tenant schema.
//
// The 92-file migration history (0001-0092) was squashed into these two baselines on 2026-08-27 —
// full record in Development-Standards.md §108. The platform baseline is the consolidated final
// shape of migrations 0001, 0003, 0005, 0027, 0029, 0048, 0050-0052, 0054-0056, 0060, 0064 and
// 0084; the tenant baseline of the 77 tenant-scoped migrations (0002-0092).
//
// ORDERING: TypeORM runs array-loaded migrations in ARRAY order (verified against the
// migrations-table history — see index.spec.ts). Both baselines are IMMUTABLE (never edit them:
// a hand-edit would diverge every fresh schema from the contract). New migrations are APPENDED
// at the end of the relevant array, never inserted mid-array; the name suffix's last-13-digit
// timestamp must stay unique and the modern (3-prefix) block ascending (both enforced by
// index.spec.ts, code-review-findings-2026-08-25 database P3).
export const PLATFORM_MIGRATIONS = [InitialPlatformSchema1000000000093];

// Tenant-scoped migrations: create per-tenant-schema tables. Run once per tenant by
// TenantProvisioningService (new tenants) and migrate-tenants.ts (backfilling existing ones).
export const TENANT_MIGRATIONS = [
  InitialTenantSchema2000000000094,
  AddPatientAllergies3000000000001,
  AddAccountWard3000000000002,
  AddPatientInsuranceInfo3000000000003,
];
