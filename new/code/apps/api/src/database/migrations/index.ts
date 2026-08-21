import { CreateRbacCatalogTables } from './0001-create-rbac-catalog-tables.js';
import { CreateTenantAccountTables } from './0002-create-tenant-account-tables.js';
import { AddRolePermissionsUniqueConstraint } from './0003-add-role-permissions-unique-constraint.js';
import { AddAccountRolesUniqueActiveAssignment } from './0004-add-account-roles-unique-active-assignment.js';
import { CreateTenantsTable } from './0005-create-tenants-table.js';
import { CreateAuditRecordsTable } from './0006-create-audit-records-table.js';
import { CreateMasterDataTables } from './0007-create-master-data-tables.js';
import { CreatePatientTables0008 } from './0008-create-patient-tables.js';
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
import { CreateInventoryTables0022 } from './0022-create-inventory-tables.js';
import { CreateInventoryRequisitionTables0023 } from './0023-create-inventory-requisition-tables.js';
import { CreatePharmacyTables0024 } from './0024-create-pharmacy-tables.js';
import { AddBillingReturnsTable0025 } from './0025-add-billing-returns-table.js';
import { AddDepartmentMaxDailyAppointments0026 } from './0026-add-department-max-daily-appointments.js';
import { CreateTenantRolesTable0027 } from './0027-create-tenant-roles-table.js';
import { CreateNotificationsTable0028 } from './0028-create-notifications-table.js';
import { CreateDepartmentCatalogTable0029 } from './0029-create-department-catalog-table.js';
import { CreateDischargeSummaryTable0030 } from './0030-create-discharge-summary-table.js';
import { AddCatalogPrices0031 } from './0031-add-catalog-prices.js';
import { AddCatalogIsActive0032 } from './0032-add-catalog-is-active.js';
import { CreateFixedAssetTables0033 } from './0033-create-fixed-asset-tables.js';
import { CreateInsuranceTables0034 } from './0034-create-insurance-tables.js';
import { CreateAccountingTables0035 } from './0035-create-accounting-tables.js';
import { CreateWardSupplyTables0036 } from './0036-create-ward-supply-tables.js';
import { CreateNursingTables0037 } from './0037-create-nursing-tables.js';
import { CreateOtTables0038 } from './0038-create-ot-tables.js';
import { CreateMaternityTables0039 } from './0039-create-maternity-tables.js';
import { CreateCssdTables0040 } from './0040-create-cssd-tables.js';
import { CreateEmployeeTables0041 } from './0041-create-employee-tables.js';
import { CreatePayrollTables0042 } from './0042-create-payroll-tables.js';
import { CreateFractionTables0043 } from './0043-create-fraction-tables.js';
import { CreateHelpdeskTables0044 } from './0044-create-helpdesk-tables.js';
import { CreateMarketingTables0045 } from './0045-create-marketing-tables.js';
import { CreateSsuTables0046 } from './0046-create-ssu-tables.js';
import { CreateVaccinationTables0047 } from './0047-create-vaccination-tables.js';
import { AddInvoiceItemChargeUnique0049 } from './0049-add-invoice-item-charge-unique.js';
import { AddTenantArchive1000000000050 } from './0050-add-tenant-archive.js';
import { CreateSubscriptionBilling1000000000051 } from './0051-create-subscription-billing.js';
import { CreatePackagesTable0048 } from './0048-create-packages-table.js';

// Platform-level migrations: create shared/public-schema tables (RBAC catalog, tenant registry).
// Run once by migrate.ts. Never replayed per-tenant schema.
export const PLATFORM_MIGRATIONS = [
  CreateRbacCatalogTables,
  AddRolePermissionsUniqueConstraint,
  CreateTenantsTable,
  CreateTenantRolesTable0027,
  CreateDepartmentCatalogTable0029,
  CreatePackagesTable0048,
  AddTenantArchive1000000000050,
  CreateSubscriptionBilling1000000000051,
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
  CreatePatientTables0008,
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
  CreateInventoryTables0022,
  CreateInventoryRequisitionTables0023,
  CreatePharmacyTables0024,
  AddBillingReturnsTable0025,
  AddDepartmentMaxDailyAppointments0026,
  CreateNotificationsTable0028,
  CreateDischargeSummaryTable0030,
  AddCatalogPrices0031,
  AddCatalogIsActive0032,
  CreateFixedAssetTables0033,
  CreateInsuranceTables0034,
  CreateAccountingTables0035,
  CreateWardSupplyTables0036,
  CreateNursingTables0037,
  CreateOtTables0038,
  CreateMaternityTables0039,
  CreateCssdTables0040,
  CreateEmployeeTables0041,
  CreatePayrollTables0042,
  CreateFractionTables0043,
  CreateHelpdeskTables0044,
  CreateMarketingTables0045,
  CreateSsuTables0046,
  CreateVaccinationTables0047,
  AddInvoiceItemChargeUnique0049,
];
