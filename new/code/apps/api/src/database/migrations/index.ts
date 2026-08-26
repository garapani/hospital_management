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
import { CreateTenantBranding1000000000052 } from './0052-create-tenant-branding.js';
import { CreatePackagesTable0048 } from './0048-create-packages-table.js';
import { AddAuditColumnsToTenantTables1000000000053 } from './0053-add-audit-columns-to-tenant-tables.js';
import { AddAuditColumnsToPlatformTables1000000000054 } from './0054-add-audit-columns-to-platform-tables.js';
import { DropSubscriptionsTenantFkCascade1000000000055 } from './0055-drop-subscriptions-tenant-fk-cascade.js';
import { AddTenantPurged1000000000056 } from './0056-add-tenant-purged.js';
import { AddBrandingTextFields1000000000060 } from './0060-add-branding-text-fields.js';
import { AddAccountPatientLink3000000000057 } from './0057-add-account-patient-link.js';
import { AddJournalSourceRef3000000000058 } from './0058-add-journal-source-ref.js';
import { SeedDefaultLedgerAccounts3000000000059 } from './0059-seed-default-ledger-accounts.js';
import { CreateAssetDepreciationEntriesTable3000000000061 } from './0061-create-asset-depreciation-entries.js';
import { AddAdmissionsActivePatientUnique3000000000062 } from './0062-add-admissions-active-patient-unique.js';
import { AddFractionEntriesUnique3000000000063 } from './0063-add-fraction-entries-unique.js';
import { DropRoleBypassesPermissionChecks3000000000064 } from './0064-drop-role-bypasses-permission-checks.js';
import { AddDischargeSummariesAdmissionUnique3000000000065 } from './0065-add-discharge-summaries-admission-unique.js';
import { AddAppointmentsActiveDoctorSlotUnique3000000000066 } from './0066-add-appointments-active-doctor-slot-unique.js';
import { AddTriageEntriesAuditColumns3000000000067 } from './0067-add-triage-entries-audit-columns.js';
import { AddMedicationAdministrationsAuditAndPrescriptionLink3000000000068 } from './0068-add-medication-administrations-audit-and-prescription-link.js';
import { AddMaternityRecordsAdmissionUnique3000000000069 } from './0069-add-maternity-records-admission-unique.js';
import { AddVaccinationRecordsDuplicateDoseUnique3000000000070 } from './0070-add-vaccination-records-duplicate-dose-unique.js';
import { AddOtSurgeriesActorAndOutcomeColumns3000000000071 } from './0071-add-ot-surgeries-actor-and-outcome-columns.js';
import { AddClinicalGroupFilterIndexes3000000000072 } from './0072-add-clinical-group-filter-indexes.js';
import { ConvertClinicalGroupActorColumnsToVarchar3000000000073 } from './0073-convert-clinical-group-actor-columns-to-varchar.js';
import { AddLabTestsCodeUnique3000000000074 } from './0074-add-lab-tests-code-unique.js';
import { AddPharmacyDispensingsReversalColumns3000000000075 } from './0075-add-pharmacy-dispensings-reversal-columns.js';
import { AddInventoryItemsCodeUniqueAndStockBalanceCheck3000000000076 } from './0076-add-inventory-items-code-unique-and-stock-balance-check.js';
import { AddWardStockBatchDimension3000000000077 } from './0077-add-ward-stock-batch-dimension.js';
import { AddCssdCodeUniqueAndCycleConstraints3000000000078 } from './0078-add-cssd-code-unique-and-cycle-constraints.js';
import { AddSsuCaseClosureAndActivePatientUnique3000000000079 } from './0079-add-ssu-case-closure-and-active-patient-unique.js';
import { AddFractionReversalAndDefaultRuleUnique3000000000080 } from './0080-add-fraction-reversal-and-default-rule-unique.js';
import { AddBillingSettingsDefaultTaxPercent3000000000081 } from './0081-add-billing-settings-default-tax-percent.js';
import { AddLedgerAccountsCodeUnique3000000000082 } from './0082-add-ledger-accounts-code-unique.js';
import { AddPatientPoliciesUniqueNumber3000000000083 } from './0083-add-patient-policies-unique-number.js';

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
  CreateTenantBranding1000000000052,
  AddAuditColumnsToPlatformTables1000000000054,
  DropSubscriptionsTenantFkCascade1000000000055,
  AddTenantPurged1000000000056,
  AddBrandingTextFields1000000000060,
  DropRoleBypassesPermissionChecks3000000000064,
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
  AddAuditColumnsToTenantTables1000000000053,
  AddAccountPatientLink3000000000057,
  AddJournalSourceRef3000000000058,
  SeedDefaultLedgerAccounts3000000000059,
  CreateAssetDepreciationEntriesTable3000000000061,
  AddAdmissionsActivePatientUnique3000000000062,
  AddFractionEntriesUnique3000000000063,
  AddDischargeSummariesAdmissionUnique3000000000065,
  AddAppointmentsActiveDoctorSlotUnique3000000000066,
  AddTriageEntriesAuditColumns3000000000067,
  AddMedicationAdministrationsAuditAndPrescriptionLink3000000000068,
  AddMaternityRecordsAdmissionUnique3000000000069,
  AddVaccinationRecordsDuplicateDoseUnique3000000000070,
  AddOtSurgeriesActorAndOutcomeColumns3000000000071,
  AddClinicalGroupFilterIndexes3000000000072,
  ConvertClinicalGroupActorColumnsToVarchar3000000000073,
  AddLabTestsCodeUnique3000000000074,
  AddPharmacyDispensingsReversalColumns3000000000075,
  AddInventoryItemsCodeUniqueAndStockBalanceCheck3000000000076,
  AddWardStockBatchDimension3000000000077,
  AddCssdCodeUniqueAndCycleConstraints3000000000078,
  AddSsuCaseClosureAndActivePatientUnique3000000000079,
  AddFractionReversalAndDefaultRuleUnique3000000000080,
  AddBillingSettingsDefaultTaxPercent3000000000081,
  AddLedgerAccountsCodeUnique3000000000082,
  AddPatientPoliciesUniqueNumber3000000000083,
];
