import { CreateRbacCatalogTables } from './0001-create-rbac-catalog-tables.js';
import { CreateTenantAccountTables } from './0002-create-tenant-account-tables.js';
import { AddRolePermissionsUniqueConstraint } from './0003-add-role-permissions-unique-constraint.js';
import { AddAccountRolesUniqueActiveAssignment } from './0004-add-account-roles-unique-active-assignment.js';
import { CreateTenantsTable } from './0005-create-tenants-table.js';
import { CreatePatientTables005 } from './005_create_patient_tables.js';
import { CreateAuditRecordsTable } from './0006-create-audit-records-table.js';
import { CreateMasterDataTables } from './0007-create-master-data-tables.js';
import { CreateAppointmentsTable0009 } from './0009-create-appointments-table.js';
import { CreateVitalsTable0010 } from './0010-create-vitals-table.js';
import { CreateEncounterTables011 } from './0011_create_encounter_tables.js';
import { CreateTriageTable0012 } from './0012-create-triage-table.js';
import { CreateBedsTable0013 } from './0013-create-beds-table.js';
import { CreateAdmissionsTables0014 } from './0014-create-admissions-tables.js';
import { CreateOrdersTables0015 } from './0015-create-orders-tables.js';
import { CreateBillingTables0016 } from './0016-create-billing-tables.js';
import { CreateReportingTables0017 } from './0017-create-reporting-tables.js';
import { CreateLabTables0018 } from './0018-create-lab-tables.js';
import { AddLabRequisitionsActiveUniqueIndex0019 } from './0019-add-lab-requisitions-active-unique-index.js';
import { CreateRadiologyTables0020 } from './0020-create-radiology-tables.js';
import { AddRadiologyRequisitionReportChecks0021 } from './0021-add-radiology-requisition-report-checks.js';

// Platform-level migrations: create shared/public-schema tables (RBAC catalog, tenant registry).
// Run once by migrate.ts. Never replayed per-tenant schema.
export const PLATFORM_MIGRATIONS = [
  CreateRbacCatalogTables,
  AddRolePermissionsUniqueConstraint,
  CreateTenantsTable,
];

// Tenant-scoped migrations: create per-tenant-schema tables. Run once per tenant by
// TenantProvisioningService (new tenants) and migrate-tenants.ts (backfilling existing ones).
// Order matches the proven-working order from the AccountsService.provisionTenantSchema()
// stand-in this replaces — dependent tables follow what they reference (e.g. account_roles
// after accounts).
export const TENANT_MIGRATIONS = [
  CreateTenantAccountTables,
  AddAccountRolesUniqueActiveAssignment,
  CreateAuditRecordsTable,
  CreateMasterDataTables,
  CreatePatientTables005,
  CreateAppointmentsTable0009,
  CreateVitalsTable0010,
  CreateEncounterTables011,
  CreateTriageTable0012,
  CreateBedsTable0013,
  CreateAdmissionsTables0014,
  CreateOrdersTables0015,
  CreateBillingTables0016,
  CreateReportingTables0017,
  CreateLabTables0018,
  AddLabRequisitionsActiveUniqueIndex0019,
  CreateRadiologyTables0020,
  AddRadiologyRequisitionReportChecks0021,
];
