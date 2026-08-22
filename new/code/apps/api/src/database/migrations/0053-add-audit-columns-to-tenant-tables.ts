import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Standard audit columns (createdBy, updatedBy, deletedAt, deletedBy) across every in-scope
 * tenant-scoped business/clinical/financial/lookup table — see
 * new/docs/superpowers/specs/2026-08-22-entity-audit-columns-design.md. createdAt/updatedAt
 * already exist on nearly every one of these tables from their original CREATE TABLE
 * migrations, so only the four new columns are added for most of them — EXCEPT `beds`,
 * `departments`, and `wards`, which had `createdAt` but never `updatedAt` (added separately
 * below), and `patient_addresses`/`patient_kins`, which had neither (verified against each
 * table's original CREATE TABLE migration, not assumed from the entity class — that assumption
 * was wrong on the first pass of this migration and caught by the full test suite provisioning a
 * fresh tenant schema). createdBy/updatedBy/deletedAt/deletedBy nullable: no backfill default
 * exists for historical rows, and some future write paths (system jobs) may have no account
 * context. IF NOT EXISTS on every statement: idempotent against re-running this migration. The 3
 * tables that already had their own `createdBy` column before this (invoices, journal_entries,
 * nursing_tasks) get `ALTER COLUMN "createdBy" TYPE varchar` instead of `ADD COLUMN IF NOT
 * EXISTS` — the latter would silently no-op on a column that already exists, leaving it `uuid` at
 * the DB level while the entity now declares `varchar` (a real bug caught by code review, not the
 * test suite — a non-uuid actor string only hits this specific column on these 3 tables, which the
 * suite's fixtures didn't happen to exercise).
 */
export class AddAuditColumnsToTenantTables1000000000053 implements MigrationInterface {
  // Sort key intentionally 3xxx, not 1xxx like migrations 50-52: TypeORM sorts migrations by
  // parsing the LAST 13 characters of `name` as a timestamp (see the migration-safety-check skill
  // / the CreatePatientTables0008 incident it documents), and migrations 0009-0049 use a
  // "2000000000NNN" sort key that is numerically LARGER than "1000000000053" would be. This
  // migration ALTERs tables created by several of those 2xxx migrations (admissions, invoices,
  // inventory_items, etc.) — a 1xxx key would sort it BEFORE those CREATE TABLEs even run,
  // failing on a table that doesn't exist yet. 3000000000053 sorts after every existing migration.
  name = 'AddAuditColumnsToTenantTables3000000000053';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // These three had createdAt but never updatedAt.
    for (const table of ['beds', 'departments', 'wards']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()`,
      );
    }
    // These two had neither.
    for (const table of ['patient_addresses', 'patient_kins']) {
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now()`,
      );
      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS "updatedAt" timestamptz NOT NULL DEFAULT now()`,
      );
    }

    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE admissions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE admissions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE admissions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE admissions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE beds ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE beds ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE beds ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE beds ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE clinical_notes ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_instruments ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_instruments ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_instruments ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE cssd_instruments ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE departments ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE diagnoses ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE discharge_summaries ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE fixed_assets ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fraction_rules ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE fraction_rules ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE fraction_rules ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE fraction_rules ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE insurance_claims ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_payers ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_payers ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE insurance_payers ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE insurance_payers ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE inventory_vendors ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    // invoices.createdBy already existed as `uuid NOT NULL` (0016-create-billing-tables.ts:41) —
    // ADD COLUMN IF NOT EXISTS would no-op and silently leave it uuid while the entity now declares
    // varchar. ALTER COLUMN TYPE converts the live column instead of assuming it's missing.
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN "createdBy" TYPE varchar USING "createdBy"::varchar`);
    await queryRunner.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    // journal_entries.createdBy: same pre-existing-uuid-column situation as invoices above
    // (0035-create-accounting-tables.ts:30).
    await queryRunner.query(`ALTER TABLE journal_entries ALTER COLUMN "createdBy" TYPE varchar USING "createdBy"::varchar`);
    await queryRunner.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_requisitions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_requisitions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_requisitions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE lab_requisitions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_categories ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_categories ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_categories ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE lab_test_categories ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_components ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_components ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_test_components ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE lab_test_components ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE lab_tests ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE ledger_accounts ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE maternity_records ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE maternity_records ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE maternity_records ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE maternity_records ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    // nursing_tasks.createdBy: same pre-existing-uuid-column situation as invoices above
    // (0037-create-nursing-tables.ts:21).
    await queryRunner.query(`ALTER TABLE nursing_tasks ALTER COLUMN "createdBy" TYPE varchar USING "createdBy"::varchar`);
    await queryRunner.query(`ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE nursing_tasks ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE ot_surgeries ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_addresses ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_addresses ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_addresses ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE patient_addresses ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_kins ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_kins ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_kins ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE patient_kins ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_policies ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_policies ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patient_policies ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE patient_policies ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE patients ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE payslips ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE payslips ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE payslips ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE payslips ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE referral_sources ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ssu_cases ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE ssu_cases ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE ssu_cases ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE ssu_cases ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE stock_batches ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisitions ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisitions ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE stock_requisitions ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE stock_requisitions ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE vaccination_records ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE vaccination_records ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE vaccination_records ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE vaccination_records ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE vitals ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE vitals ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE vitals ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE vitals ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
    await queryRunner.query(`ALTER TABLE wards ADD COLUMN IF NOT EXISTS "createdBy" varchar`);
    await queryRunner.query(`ALTER TABLE wards ADD COLUMN IF NOT EXISTS "updatedBy" varchar`);
    await queryRunner.query(`ALTER TABLE wards ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz`);
    await queryRunner.query(`ALTER TABLE wards ADD COLUMN IF NOT EXISTS "deletedBy" varchar`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE accounts DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE admissions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE admissions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE admissions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE admissions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE appointments DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE beds DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE beds DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE beds DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE beds DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE billing_settings DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE billing_settings DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE billing_settings DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE billing_settings DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE clinical_notes DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE clinical_notes DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE clinical_notes DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE clinical_notes DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE cssd_instruments DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE cssd_instruments DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE cssd_instruments DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE cssd_instruments DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE cssd_sterilization_cycles DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE departments DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE deposits DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE deposits DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE deposits DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE deposits DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE diagnoses DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE diagnoses DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE diagnoses DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE diagnoses DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE discharge_summaries DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE discharge_summaries DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE discharge_summaries DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE discharge_summaries DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE employees DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE fixed_asset_categories DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE fixed_assets DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE fixed_assets DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE fixed_assets DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE fixed_assets DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE fraction_rules DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE fraction_rules DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE fraction_rules DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE fraction_rules DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE helpdesk_tickets DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE insurance_claims DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE insurance_claims DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE insurance_claims DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE insurance_claims DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE insurance_payers DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE insurance_payers DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE insurance_payers DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE insurance_payers DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_categories DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_item_sub_categories DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE inventory_items DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_items DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE inventory_items DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_items DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE inventory_vendors DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_vendors DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE inventory_vendors DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE inventory_vendors DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE invoices DROP COLUMN IF EXISTS "updatedBy"`);
    // createdBy predates this migration (was already uuid) — revert the type, don't drop the column.
    await queryRunner.query(`ALTER TABLE invoices ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid`);
    await queryRunner.query(`ALTER TABLE journal_entries DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE journal_entries DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE journal_entries DROP COLUMN IF EXISTS "updatedBy"`);
    // createdBy predates this migration (was already uuid) — revert the type, don't drop the column.
    await queryRunner.query(`ALTER TABLE journal_entries ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid`);
    await queryRunner.query(`ALTER TABLE lab_requisitions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE lab_requisitions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE lab_requisitions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE lab_requisitions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_categories DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_categories DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE lab_test_categories DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_categories DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_components DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_components DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE lab_test_components DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE lab_test_components DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE lab_tests DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE lab_tests DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE lab_tests DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE lab_tests DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE ledger_accounts DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE maternity_records DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE maternity_records DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE maternity_records DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE maternity_records DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE nursing_tasks DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE nursing_tasks DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE nursing_tasks DROP COLUMN IF EXISTS "updatedBy"`);
    // createdBy predates this migration (was already uuid) — revert the type, don't drop the column.
    await queryRunner.query(`ALTER TABLE nursing_tasks ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE order_items DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE ot_surgeries DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE patient_addresses DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE patient_addresses DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE patient_addresses DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE patient_addresses DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE patient_kins DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE patient_kins DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE patient_kins DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE patient_kins DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE patient_policies DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE patient_policies DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE patient_policies DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE patient_policies DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE patients DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE payslips DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE payslips DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE payslips DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE payslips DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE pharmacy_dispensings DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE prescriptions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE prescriptions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE prescriptions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE prescriptions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE purchase_orders DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_items DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_imaging_types DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE radiology_requisitions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE referral_sources DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE referral_sources DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE referral_sources DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE referral_sources DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE ssu_cases DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE ssu_cases DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE ssu_cases DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE ssu_cases DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE stock_batches DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE stock_batches DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE stock_batches DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE stock_batches DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisition_items DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisitions DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisitions DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE stock_requisitions DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE stock_requisitions DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE vaccination_records DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE vaccination_records DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE vaccination_records DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE vaccination_records DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE vitals DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE vitals DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE vitals DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE vitals DROP COLUMN IF EXISTS "createdBy"`);
    await queryRunner.query(`ALTER TABLE wards DROP COLUMN IF EXISTS "deletedBy"`);
    await queryRunner.query(`ALTER TABLE wards DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE wards DROP COLUMN IF EXISTS "updatedBy"`);
    await queryRunner.query(`ALTER TABLE wards DROP COLUMN IF EXISTS "createdBy"`);

    for (const table of ['patient_addresses', 'patient_kins']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "updatedAt"`);
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "createdAt"`);
    }
    for (const table of ['beds', 'departments', 'wards']) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS "updatedAt"`);
    }
  }
}
