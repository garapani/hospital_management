import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SQUASHED TENANT BASELINE (2026-08-27): the consolidated per-tenant-schema state of migrations
 * 0002-0004, 0006-0009, 0011-0026, 0028, 0030-0047, 0049, 0053, 0057-0059, 0061-0063, 0065-0083,
 * 0085-0092 (77 migrations, ~77 files) in final shape, generated from `pg_dump --schema-only` of
 * a fully-migrated tenant schema, NOT hand-written. The whole ALTER chain collapsed into final
 * CREATE TABLE statements; every index, constraint, check and partial unique index carries its
 * production name. See Development-Standards.md §108 (the squash record) before touching this
 * file.
 *
 * Rules that apply to this file:
 *  - APPEND-ONLY / IMMUTABLE: never edit it (same rule as the platform baseline).
 *  - Runs under the tenant provisioning search_path connection (tenant-migration-data-source.ts
 *    `-c search_path=<tenant_schema>,public`), so every statement is unqualified — the dump's
 *    schema qualification and search_path reset were stripped for exactly this reason.
 *  - SCHEMA ONLY: the nine system ledger accounts (formerly migrations 0059/0085/0086) are
 *    seeded by seedSystemLedgerAccounts() at provisioning time (TenantProvisioningService) and by
 *    the `seed-ledger-accounts` runner for already-provisioned schemas — single source of truth
 *    is accounting/ledger-account-codes.ts (LEDGER_ACCOUNTS).
 *  - `down()` is intentionally a no-op: baselines are never reverted, and dropping a tenant's
 *    schema is purge's job.
 */
export class InitialTenantSchema2000000000094 implements MigrationInterface {
  name = 'InitialTenantSchema2000000000094';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`


      SET default_tablespace = '';

      SET default_table_access_method = heap;

      --
      -- Name: account_roles; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE account_roles (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "accountId" uuid NOT NULL,
          "roleId" uuid NOT NULL,
          "startDate" timestamp with time zone,
          "endDate" timestamp with time zone,
          "isActive" boolean DEFAULT true NOT NULL
      );


      --
      -- Name: accounts; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE accounts (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "accountType" character varying(20) NOT NULL,
          "displayName" character varying NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "needsPasswordUpdate" boolean DEFAULT false NOT NULL,
          "failedLoginAttempts" integer DEFAULT 0 NOT NULL,
          "lockedUntil" timestamp with time zone,
          username character varying,
          email character varying,
          "passwordHash" character varying,
          "phoneNumber" character varying,
          "phoneVerifiedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "patientId" uuid
      );


      --
      -- Name: admissions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE admissions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "admissionSource" character varying NOT NULL,
          "sourceAppointmentId" uuid,
          "sourceTriageEntryId" uuid,
          "admittingDoctorId" uuid NOT NULL,
          "wardId" uuid NOT NULL,
          "bedId" uuid NOT NULL,
          "admissionDate" timestamp with time zone DEFAULT now() NOT NULL,
          status character varying DEFAULT 'Admitted'::character varying NOT NULL,
          "dischargeDate" timestamp with time zone,
          "dischargeType" character varying,
          "dischargeCondition" character varying,
          "dischargeSummary" text,
          "dischargedBy" uuid,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: appointments; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE appointments (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid,
          "firstName" character varying(100) NOT NULL,
          "lastName" character varying(100) NOT NULL,
          "contactNumber" character varying(20) NOT NULL,
          "appointmentDate" date NOT NULL,
          "appointmentTime" time without time zone NOT NULL,
          "doctorId" uuid,
          "departmentId" uuid,
          "appointmentType" character varying(50) NOT NULL,
          status character varying(50) NOT NULL,
          reason text,
          "cancelledRemarks" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: asset_depreciation_entries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE asset_depreciation_entries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "assetId" uuid NOT NULL,
          "periodMonth" integer NOT NULL,
          "periodYear" integer NOT NULL,
          "depreciationAmount" numeric(12,2) NOT NULL,
          "accumulatedDepreciation" numeric(12,2) NOT NULL,
          "bookValue" numeric(12,2) NOT NULL,
          "accruedBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: audit_records; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE audit_records (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "tableName" character varying NOT NULL,
          "recordId" character varying NOT NULL,
          action character varying(20) NOT NULL,
          "changedByAccountId" character varying,
          "correlationId" character varying,
          diff jsonb NOT NULL,
          "occurredAt" timestamp with time zone NOT NULL
      );


      --
      -- Name: bed_transfers; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE bed_transfers (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "admissionId" uuid NOT NULL,
          "fromBedId" uuid,
          "toBedId" uuid NOT NULL,
          "transferredAt" timestamp with time zone DEFAULT now() NOT NULL,
          "transferredBy" uuid NOT NULL,
          reason text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: beds; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE beds (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "wardId" uuid NOT NULL,
          "bedNumber" character varying NOT NULL,
          "bedType" character varying,
          status character varying DEFAULT 'Available'::character varying NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: billing_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE billing_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: billing_settings; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE billing_settings (
          id character varying(20) NOT NULL,
          gstin character varying(15) NOT NULL,
          "stateCode" character varying(2) NOT NULL,
          "hospitalLegalName" character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "defaultTaxPercent" numeric(5,2) DEFAULT 0 NOT NULL
      );


      --
      -- Name: clinical_notes; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE clinical_notes (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "appointmentId" uuid,
          "doctorId" uuid NOT NULL,
          "chiefComplaint" text,
          "historyOfPresentingIllness" text,
          "physicalExamination" text,
          plan text,
          status character varying(50) DEFAULT 'Draft'::character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: cssd_instruments; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE cssd_instruments (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          code character varying NOT NULL,
          name character varying NOT NULL,
          category character varying,
          quantity integer DEFAULT 0 NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: cssd_sterilization_cycles; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE cssd_sterilization_cycles (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "instrumentId" uuid NOT NULL,
          method character varying NOT NULL,
          "startedAt" timestamp with time zone,
          "completedAt" timestamp with time zone,
          status character varying DEFAULT 'InProgress'::character varying NOT NULL,
          "sterileExpiryAt" timestamp with time zone,
          "operatedBy" uuid NOT NULL,
          "failureReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: departments; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE departments (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentCode" character varying NOT NULL,
          "departmentName" character varying NOT NULL,
          description character varying,
          "isActive" boolean DEFAULT true NOT NULL,
          "isAppointmentApplicable" boolean DEFAULT false NOT NULL,
          "parentDepartmentId" uuid,
          "roomNumber" character varying,
          "noticeText" character varying,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "maxDailyAppointments" integer,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: deposits; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE deposits (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          amount numeric(12,2) NOT NULL,
          balance numeric(12,2) NOT NULL,
          "receivedBy" uuid NOT NULL,
          "receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
          notes text,
          "refundedBy" uuid,
          "refundedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: diagnoses; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE diagnoses (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "appointmentId" uuid,
          "doctorId" uuid NOT NULL,
          "icd10Code" character varying(50),
          description character varying(500) NOT NULL,
          "isPrimary" boolean DEFAULT false NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: discharge_summaries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE discharge_summaries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "admissionId" uuid NOT NULL,
          "patientId" uuid NOT NULL,
          "primaryDiagnosis" text,
          "secondaryDiagnoses" text[] DEFAULT '{}'::text[] NOT NULL,
          "proceduresPerformed" text[] DEFAULT '{}'::text[] NOT NULL,
          "hospitalCourse" text,
          "dischargeMedications" text,
          "followUpInstructions" text,
          "warningSigns" text,
          "activityRestrictions" text,
          "followUpAppointmentDate" timestamp with time zone,
          "followUpDoctorId" uuid,
          "dietRecommendations" text,
          "additionalNotes" text,
          "preparedBy" uuid NOT NULL,
          "reviewedBy" uuid,
          "reviewedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: employee_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE employee_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: employees; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE employees (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "employeeCode" character varying NOT NULL,
          "firstName" character varying NOT NULL,
          "lastName" character varying NOT NULL,
          "departmentId" uuid,
          designation character varying,
          phone character varying,
          email character varying,
          "joinDate" date NOT NULL,
          "employmentType" character varying DEFAULT 'FullTime'::character varying NOT NULL,
          "monthlyBasicSalary" numeric(12,2) DEFAULT 0 NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: fixed_asset_categories; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE fixed_asset_categories (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: fixed_asset_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE fixed_asset_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: fixed_assets; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE fixed_assets (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "assetCode" character varying NOT NULL,
          "categoryId" uuid NOT NULL,
          name character varying NOT NULL,
          description text,
          "purchaseDate" date NOT NULL,
          "purchaseCost" numeric(12,2) NOT NULL,
          "supplierName" character varying,
          "departmentId" uuid,
          condition character varying DEFAULT 'In Service'::character varying NOT NULL,
          "depreciationMethod" character varying DEFAULT 'straight-line'::character varying NOT NULL,
          "usefulLifeYears" numeric(5,2),
          "salvageValue" numeric(12,2) DEFAULT 0 NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: fraction_entries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE fraction_entries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "invoiceId" uuid NOT NULL,
          "doctorId" uuid NOT NULL,
          "fractionPercent" numeric(5,2) NOT NULL,
          "baseAmount" numeric(14,2) NOT NULL,
          "shareAmount" numeric(14,2) NOT NULL,
          "recordedBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "reversedAt" timestamp with time zone,
          "reversedBy" character varying
      );


      --
      -- Name: fraction_rules; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE fraction_rules (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "doctorId" uuid NOT NULL,
          "departmentId" uuid,
          "fractionPercent" numeric(5,2) NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: helpdesk_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE helpdesk_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: helpdesk_tickets; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE helpdesk_tickets (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "ticketNumber" character varying NOT NULL,
          title character varying NOT NULL,
          description text NOT NULL,
          category character varying,
          priority character varying DEFAULT 'Medium'::character varying NOT NULL,
          status character varying DEFAULT 'Open'::character varying NOT NULL,
          "requesterAccountId" uuid NOT NULL,
          "assigneeAccountId" uuid,
          "resolvedBy" uuid,
          "resolvedAt" timestamp with time zone,
          "closedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: insurance_claim_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE insurance_claim_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: insurance_claims; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE insurance_claims (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "claimNumber" character varying NOT NULL,
          "patientId" uuid NOT NULL,
          "policyId" uuid NOT NULL,
          "invoiceId" uuid NOT NULL,
          "amountClaimed" numeric(14,2) NOT NULL,
          "amountApproved" numeric(14,2),
          status character varying DEFAULT 'Draft'::character varying NOT NULL,
          remarks text,
          "submittedBy" uuid NOT NULL,
          "processedBy" uuid,
          "submittedAt" timestamp with time zone,
          "processedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: insurance_payers; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE insurance_payers (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          type character varying NOT NULL,
          "contactPerson" character varying,
          phone character varying,
          address text,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: inventory_item_categories; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE inventory_item_categories (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "displaySequence" integer DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: inventory_item_sub_categories; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE inventory_item_sub_categories (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "categoryId" uuid NOT NULL,
          name character varying NOT NULL,
          "isConsumable" boolean DEFAULT false NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: inventory_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE inventory_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "subCategoryId" uuid NOT NULL,
          name character varying NOT NULL,
          code character varying NOT NULL,
          "unitOfMeasure" character varying NOT NULL,
          "reorderLevel" numeric DEFAULT 0 NOT NULL,
          "minimumStock" numeric DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "salePrice" numeric(10,2),
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: inventory_vendors; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE inventory_vendors (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "contactPerson" character varying,
          phone character varying,
          address character varying,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: invoice_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE invoice_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "invoiceId" uuid NOT NULL,
          "sourceOrderItemId" uuid,
          description text NOT NULL,
          "hsnSacCode" character varying(20),
          quantity numeric(10,2) DEFAULT 1 NOT NULL,
          "unitPrice" numeric(12,2) NOT NULL,
          "discountAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          "taxPercent" numeric(5,2) DEFAULT 0 NOT NULL,
          "cgstAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          "sgstAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          "totalAmount" numeric(12,2) NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: invoices; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE invoices (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "sourceAppointmentId" uuid,
          "sourceAdmissionId" uuid,
          "invoiceNumber" integer NOT NULL,
          "financialYear" character varying(10) NOT NULL,
          subtotal numeric(12,2) NOT NULL,
          "discountAmount" numeric(12,2) NOT NULL,
          "taxableAmount" numeric(12,2) NOT NULL,
          "taxAmount" numeric(12,2) NOT NULL,
          "totalAmount" numeric(12,2) NOT NULL,
          "paidAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          status character varying(20) DEFAULT 'Unpaid'::character varying NOT NULL,
          notes text,
          "createdBy" character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: journal_entries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE journal_entries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "journalNumber" character varying NOT NULL,
          "entryDate" date NOT NULL,
          narration text,
          status character varying DEFAULT 'Draft'::character varying NOT NULL,
          "createdBy" character varying NOT NULL,
          "postedBy" uuid,
          "postedAt" timestamp with time zone,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "sourceType" character varying(40),
          "sourceId" uuid
      );


      --
      -- Name: journal_lines; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE journal_lines (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "journalId" uuid NOT NULL,
          "accountId" uuid NOT NULL,
          debit numeric(14,2) DEFAULT 0 NOT NULL,
          credit numeric(14,2) DEFAULT 0 NOT NULL,
          "lineNarration" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: journal_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE journal_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: lab_requisition_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_requisition_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: lab_requisitions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_requisitions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "orderItemId" uuid NOT NULL,
          "testId" uuid NOT NULL,
          "requisitionNumber" character varying NOT NULL,
          "specimenType" character varying NOT NULL,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          "sampleCollectedBy" uuid,
          "sampleCollectedAt" timestamp with time zone,
          "verifiedBy" uuid,
          "verifiedAt" timestamp with time zone,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: lab_results; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_results (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "requisitionId" uuid NOT NULL,
          "componentId" uuid NOT NULL,
          value character varying NOT NULL,
          "isAbnormal" boolean DEFAULT false NOT NULL,
          "enteredBy" uuid NOT NULL,
          "enteredAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: lab_test_categories; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_test_categories (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "displaySequence" integer DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: lab_test_components; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_test_components (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "testId" uuid NOT NULL,
          name character varying NOT NULL,
          unit character varying,
          "referenceRangeLow" numeric,
          "referenceRangeHigh" numeric,
          "referenceRangeText" character varying,
          "displaySequence" integer DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: lab_tests; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE lab_tests (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "categoryId" uuid NOT NULL,
          name character varying NOT NULL,
          code character varying NOT NULL,
          "specimenType" character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          price numeric(10,2),
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: ledger_accounts; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ledger_accounts (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "accountCode" character varying NOT NULL,
          name character varying NOT NULL,
          type character varying NOT NULL,
          "parentAccountId" uuid,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: maternity_records; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE maternity_records (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "admissionId" uuid NOT NULL,
          "patientId" uuid NOT NULL,
          gravida integer DEFAULT 0 NOT NULL,
          para integer DEFAULT 0 NOT NULL,
          lmp date,
          edd date,
          "deliveryDate" date,
          "deliveryType" character varying,
          "babyCount" integer DEFAULT 0 NOT NULL,
          complications text,
          "deliveredBy" uuid,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: medication_administrations; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE medication_administrations (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "admissionId" uuid NOT NULL,
          "drugName" character varying NOT NULL,
          dose character varying NOT NULL,
          route character varying,
          "scheduledAt" timestamp with time zone,
          status character varying DEFAULT 'Scheduled'::character varying NOT NULL,
          "administeredBy" character varying,
          "administeredAt" timestamp with time zone,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "skippedBy" character varying,
          "prescriptionId" uuid
      );


      --


      --
      -- Name: notifications; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE notifications (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "recipientAccountId" uuid NOT NULL,
          title character varying NOT NULL,
          message character varying NOT NULL,
          type character varying DEFAULT 'info'::character varying NOT NULL,
          "isRead" boolean DEFAULT false NOT NULL,
          link character varying,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: nursing_tasks; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE nursing_tasks (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "admissionId" uuid NOT NULL,
          "taskType" character varying NOT NULL,
          description text NOT NULL,
          "dueAt" timestamp with time zone,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          "assignedTo" uuid,
          "completedBy" character varying,
          "completedAt" timestamp with time zone,
          "createdBy" character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: order_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE order_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "orderId" uuid NOT NULL,
          "itemType" character varying NOT NULL,
          "itemDescription" text NOT NULL,
          priority character varying DEFAULT 'Routine'::character varying NOT NULL,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          "completedBy" uuid,
          "completedAt" timestamp with time zone,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: orders; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE orders (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "sourceAppointmentId" uuid,
          "sourceAdmissionId" uuid,
          "orderedBy" uuid NOT NULL,
          "orderedAt" timestamp with time zone DEFAULT now() NOT NULL,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: ot_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ot_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: ot_surgeries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ot_surgeries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "surgeryNumber" character varying NOT NULL,
          "patientId" uuid NOT NULL,
          "admissionId" uuid,
          "procedureName" character varying NOT NULL,
          "otRoom" character varying,
          "scheduledAt" timestamp with time zone,
          "surgeonId" uuid,
          "anesthesiologistId" uuid,
          status character varying DEFAULT 'Scheduled'::character varying NOT NULL,
          "startedAt" timestamp with time zone,
          "endedAt" timestamp with time zone,
          notes text,
          "scheduledBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "startedBy" uuid,
          "completedBy" uuid,
          "cancelledBy" uuid,
          "cancellationReason" text,
          "postOpNotes" text
      );


      --
      -- Name: patient_addresses; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patient_addresses (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "addressType" character varying(20) DEFAULT 'home'::character varying NOT NULL,
          "streetAddress" character varying(255),
          city character varying(100),
          state character varying(100),
          "postalCode" character varying(20),
          country character varying(100) DEFAULT 'India'::character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: patient_kins; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patient_kins (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "kinName" character varying(150) NOT NULL,
          relationship character varying(50) NOT NULL,
          "phoneNumber" character varying(20) NOT NULL,
          email character varying(150),
          address character varying(255),
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: patient_policies; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patient_policies (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "payerId" uuid NOT NULL,
          "policyNumber" character varying NOT NULL,
          "insuredName" character varying,
          "relationshipToInsured" character varying,
          "coverageStartDate" date NOT NULL,
          "coverageEndDate" date NOT NULL,
          "sumInsured" numeric(14,2) NOT NULL,
          "copayPercent" numeric(5,2) DEFAULT 0 NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: patient_referrals; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patient_referrals (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "sourceId" uuid NOT NULL,
          "referredByDoctorId" uuid,
          "referredAt" timestamp with time zone DEFAULT now() NOT NULL,
          notes text,
          "recordedBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: patient_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patient_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: patients; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE patients (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientNo" character varying(50) NOT NULL,
          "firstName" character varying(100) NOT NULL,
          "middleName" character varying(100),
          "lastName" character varying(100) NOT NULL,
          gender character varying(20) NOT NULL,
          "dateOfBirth" date,
          age character varying(20),
          "phoneNumber" character varying(20),
          email character varying(150),
          "bloodGroup" character varying(10),
          "governmentIdType" character varying(50),
          "governmentIdNumber" character varying(100),
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: payments; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE payments (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "invoiceId" uuid NOT NULL,
          amount numeric(12,2) NOT NULL,
          "paymentMode" character varying(20) NOT NULL,
          "sourceDepositId" uuid,
          "receivedBy" uuid NOT NULL,
          "receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: payslips; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE payslips (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "employeeId" uuid NOT NULL,
          "periodMonth" integer NOT NULL,
          "periodYear" integer NOT NULL,
          "basicAmount" numeric(12,2) NOT NULL,
          "allowanceAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          "grossAmount" numeric(12,2) NOT NULL,
          "deductionAmount" numeric(12,2) DEFAULT 0 NOT NULL,
          "netAmount" numeric(12,2) NOT NULL,
          status character varying DEFAULT 'Draft'::character varying NOT NULL,
          "processedBy" uuid NOT NULL,
          "paidAt" timestamp with time zone,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          CONSTRAINT "CHK_payslips_net_non_negative" CHECK (("netAmount" >= (0)::numeric))
      );


      --
      -- Name: pharmacy_dispensing_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE pharmacy_dispensing_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: pharmacy_dispensings; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE pharmacy_dispensings (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "orderItemId" uuid NOT NULL,
          "inventoryItemId" uuid NOT NULL,
          "dispensingNumber" character varying NOT NULL,
          quantity numeric NOT NULL,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          "dispensedBy" uuid,
          "dispensedAt" timestamp with time zone,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "reversedBy" uuid,
          "reversedAt" timestamp with time zone,
          "reversalReason" text
      );


      --
      -- Name: prescriptions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE prescriptions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "appointmentId" uuid,
          "doctorId" uuid NOT NULL,
          "medicationName" character varying(255) NOT NULL,
          dosage character varying(100) NOT NULL,
          frequency character varying(100) NOT NULL,
          route character varying(100) NOT NULL,
          "durationDays" integer NOT NULL,
          notes text,
          status character varying(50) DEFAULT 'Active'::character varying NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: purchase_order_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE purchase_order_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "purchaseOrderId" uuid NOT NULL,
          "itemId" uuid NOT NULL,
          "orderedQuantity" numeric NOT NULL,
          "receivedQuantity" numeric DEFAULT 0 NOT NULL,
          "unitCost" numeric NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: purchase_order_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE purchase_order_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: purchase_orders; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE purchase_orders (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "vendorId" uuid NOT NULL,
          "purchaseOrderNumber" character varying NOT NULL,
          "orderedBy" uuid NOT NULL,
          "orderedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
          status character varying DEFAULT 'Ordered'::character varying NOT NULL,
          notes text,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: radiology_imaging_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE radiology_imaging_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "imagingTypeId" uuid NOT NULL,
          name character varying NOT NULL,
          "procedureCode" character varying,
          "displaySequence" integer DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          price numeric(10,2),
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: radiology_imaging_types; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE radiology_imaging_types (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "procedureCoding" character varying,
          "displaySequence" integer DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: radiology_requisition_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE radiology_requisition_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: radiology_requisitions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE radiology_requisitions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "orderItemId" uuid NOT NULL,
          "imagingItemId" uuid NOT NULL,
          "requisitionNumber" character varying NOT NULL,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          "scannedBy" uuid,
          "scannedAt" timestamp with time zone,
          "reportText" text,
          indication text,
          "performerId" uuid,
          "reportEnteredBy" uuid,
          "reportEnteredAt" timestamp with time zone,
          "verifiedBy" uuid,
          "verifiedAt" timestamp with time zone,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          CONSTRAINT "CHK_radiology_requisitions_report_entered_complete" CHECK ((((status)::text <> ALL ((ARRAY['ReportEntered'::character varying, 'Verified'::character varying])::text[])) OR (("reportText" IS NOT NULL) AND ("reportEnteredBy" IS NOT NULL)))),
          CONSTRAINT "CHK_radiology_requisitions_scanned_complete" CHECK ((((status)::text <> ALL ((ARRAY['Scanned'::character varying, 'ReportEntered'::character varying, 'Verified'::character varying])::text[])) OR (("scannedBy" IS NOT NULL) AND ("scannedAt" IS NOT NULL)))),
          CONSTRAINT "CHK_radiology_requisitions_verified_complete" CHECK ((((status)::text <> 'Verified'::text) OR (("verifiedBy" IS NOT NULL) AND ("verifiedAt" IS NOT NULL))))
      );


      --
      -- Name: referral_sources; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE referral_sources (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          name character varying NOT NULL,
          "sourceType" character varying DEFAULT 'Other'::character varying NOT NULL,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: reporting_events; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE reporting_events (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "eventType" character varying NOT NULL,
          "entityId" uuid NOT NULL,
          payload jsonb NOT NULL,
          "occurredAt" timestamp with time zone DEFAULT now() NOT NULL,
          "correlationId" character varying,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: returns; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE returns (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "invoiceId" uuid NOT NULL,
          amount numeric(12,2) NOT NULL,
          reason text NOT NULL,
          "returnedBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: ssu_cases; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ssu_cases (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "caseNumber" character varying NOT NULL,
          "patientId" uuid NOT NULL,
          "caseType" character varying NOT NULL,
          "eligibilityNotes" text,
          "subsidyPercent" numeric(5,2) DEFAULT 0 NOT NULL,
          status character varying DEFAULT 'Open'::character varying NOT NULL,
          "appliedBy" uuid NOT NULL,
          "approvedBy" uuid,
          "approvedAt" timestamp with time zone,
          "decisionNotes" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying,
          "closedBy" character varying,
          "closedAt" timestamp with time zone
      );


      --
      -- Name: ssu_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ssu_sequences (
          prefix character varying NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer NOT NULL
      );


      --
      -- Name: stock_balances; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_balances (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "itemId" uuid NOT NULL,
          "stockBatchId" uuid NOT NULL,
          "availableQuantity" numeric DEFAULT 0 NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "CHK_stock_balances_available_quantity_non_negative" CHECK (("availableQuantity" >= (0)::numeric))
      );


      --
      -- Name: stock_batches; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_batches (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "itemId" uuid NOT NULL,
          "batchNumber" character varying NOT NULL,
          "expiryDate" date,
          "unitCost" numeric NOT NULL,
          mrp numeric,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: stock_requisition_items; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_requisition_items (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "requisitionId" uuid NOT NULL,
          "itemId" uuid NOT NULL,
          "requestedQuantity" numeric NOT NULL,
          "fulfilledQuantity" numeric DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: stock_requisition_sequences; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_requisition_sequences (
          prefix character varying(20) NOT NULL,
          year integer NOT NULL,
          "lastSequence" integer DEFAULT 0 NOT NULL
      );


      --
      -- Name: stock_requisitions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_requisitions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentId" uuid NOT NULL,
          "requestedBy" uuid NOT NULL,
          "requisitionNumber" character varying NOT NULL,
          status character varying DEFAULT 'Pending'::character varying NOT NULL,
          notes text,
          "cancelReason" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: stock_transactions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE stock_transactions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "itemId" uuid NOT NULL,
          "stockBatchId" uuid NOT NULL,
          "transactionType" character varying NOT NULL,
          "referenceId" uuid,
          quantity numeric NOT NULL,
          "recordedBy" uuid NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: triage_entries; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE triage_entries (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid,
          "firstName" character varying,
          "lastName" character varying,
          gender character varying,
          "estimatedAge" character varying,
          "arrivalMode" character varying,
          "broughtBy" character varying,
          "isPoliceCase" boolean DEFAULT false NOT NULL,
          "chiefComplaint" text,
          "acuityLevel" integer,
          "colorCode" character varying,
          "triagedBy" character varying,
          "triagedAt" timestamp with time zone,
          status character varying DEFAULT 'Arrived'::character varying NOT NULL,
          "dischargeRemarks" text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: vaccination_records; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE vaccination_records (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          vaccine character varying NOT NULL,
          "doseNumber" integer DEFAULT 1 NOT NULL,
          "administeredDate" date NOT NULL,
          "batchNumber" character varying,
          "administeredBy" uuid NOT NULL,
          notes text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: vitals; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE vitals (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "patientId" uuid NOT NULL,
          "appointmentId" uuid,
          height numeric(5,2),
          weight numeric(5,2),
          bmi numeric(5,2),
          temperature numeric(4,1),
          pulse integer,
          "bpSystolic" integer,
          "bpDiastolic" integer,
          "respiratoryRate" integer,
          "spO2" numeric(5,2),
          "painScale" integer,
          "triageNotes" text,
          "recordedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
          "createdAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: ward_stock_balances; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ward_stock_balances (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentId" uuid NOT NULL,
          "itemId" uuid NOT NULL,
          "availableQuantity" numeric(12,2) DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
      );


      --
      -- Name: ward_stock_batches; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ward_stock_batches (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentId" uuid NOT NULL,
          "itemId" uuid NOT NULL,
          "batchNumber" character varying DEFAULT ''::character varying NOT NULL,
          "expiryDate" date,
          quantity numeric(12,2) DEFAULT 0 NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          CONSTRAINT "CHK_ward_stock_batches_quantity_non_negative" CHECK ((quantity >= (0)::numeric))
      );


      --
      -- Name: ward_stock_transactions; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE ward_stock_transactions (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "departmentId" uuid NOT NULL,
          "itemId" uuid NOT NULL,
          "transactionType" character varying NOT NULL,
          quantity numeric(12,2) NOT NULL,
          "patientId" uuid,
          "admissionId" uuid,
          "performedBy" uuid NOT NULL,
          "performedAt" timestamp with time zone DEFAULT now() NOT NULL,
          remarks text,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "batchNumber" character varying,
          "expiryDate" date
      );


      --
      -- Name: wards; Type: TABLE; Schema: tenant_squash_before; Owner: -
      --

      CREATE TABLE wards (
          id uuid DEFAULT gen_random_uuid() NOT NULL,
          "wardCode" character varying NOT NULL,
          "wardName" character varying NOT NULL,
          "wardType" character varying,
          "bedCapacity" integer,
          "isActive" boolean DEFAULT true NOT NULL,
          "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
          "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
          "createdBy" character varying,
          "updatedBy" character varying,
          "deletedAt" timestamp with time zone,
          "deletedBy" character varying
      );


      --
      -- Name: notifications PK_notifications; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY notifications
          ADD CONSTRAINT "PK_notifications" PRIMARY KEY (id);


      --
      -- Name: reporting_events PK_reporting_events; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY reporting_events
          ADD CONSTRAINT "PK_reporting_events" PRIMARY KEY (id);


      --
      -- Name: triage_entries PK_triage_entries; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY triage_entries
          ADD CONSTRAINT "PK_triage_entries" PRIMARY KEY (id);


      --
      -- Name: beds UQ_beds_ward_bed_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY beds
          ADD CONSTRAINT "UQ_beds_ward_bed_number" UNIQUE ("wardId", "bedNumber");


      --
      -- Name: cssd_instruments UQ_cssd_instruments_code; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY cssd_instruments
          ADD CONSTRAINT "UQ_cssd_instruments_code" UNIQUE (code);


      --
      -- Name: fraction_entries UQ_fraction_entries_invoice_doctor; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fraction_entries
          ADD CONSTRAINT "UQ_fraction_entries_invoice_doctor" UNIQUE ("invoiceId", "doctorId");


      --
      -- Name: inventory_items UQ_inventory_items_code; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY inventory_items
          ADD CONSTRAINT "UQ_inventory_items_code" UNIQUE (code);


      --
      -- Name: invoices UQ_invoices_number_fy; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY invoices
          ADD CONSTRAINT "UQ_invoices_number_fy" UNIQUE ("financialYear", "invoiceNumber");


      --
      -- Name: lab_requisitions UQ_lab_requisitions_requisition_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_requisitions
          ADD CONSTRAINT "UQ_lab_requisitions_requisition_number" UNIQUE ("requisitionNumber");


      --
      -- Name: lab_results UQ_lab_results_requisition_component; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_results
          ADD CONSTRAINT "UQ_lab_results_requisition_component" UNIQUE ("requisitionId", "componentId");


      --
      -- Name: lab_tests UQ_lab_tests_code; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_tests
          ADD CONSTRAINT "UQ_lab_tests_code" UNIQUE (code);


      --
      -- Name: ledger_accounts UQ_ledger_accounts_accountCode; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ledger_accounts
          ADD CONSTRAINT "UQ_ledger_accounts_accountCode" UNIQUE ("accountCode");


      --
      -- Name: pharmacy_dispensings UQ_pharmacy_dispensings_dispensing_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY pharmacy_dispensings
          ADD CONSTRAINT "UQ_pharmacy_dispensings_dispensing_number" UNIQUE ("dispensingNumber");


      --
      -- Name: purchase_orders UQ_purchase_orders_purchase_order_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY purchase_orders
          ADD CONSTRAINT "UQ_purchase_orders_purchase_order_number" UNIQUE ("purchaseOrderNumber");


      --
      -- Name: radiology_requisitions UQ_radiology_requisitions_requisition_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY radiology_requisitions
          ADD CONSTRAINT "UQ_radiology_requisitions_requisition_number" UNIQUE ("requisitionNumber");


      --
      -- Name: referral_sources UQ_referral_sources_name; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY referral_sources
          ADD CONSTRAINT "UQ_referral_sources_name" UNIQUE (name);


      --
      -- Name: stock_balances UQ_stock_balances_item_batch; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_balances
          ADD CONSTRAINT "UQ_stock_balances_item_batch" UNIQUE ("itemId", "stockBatchId");


      --
      -- Name: stock_requisitions UQ_stock_requisitions_requisition_number; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_requisitions
          ADD CONSTRAINT "UQ_stock_requisitions_requisition_number" UNIQUE ("requisitionNumber");


      --
      -- Name: account_roles account_roles_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY account_roles
          ADD CONSTRAINT account_roles_pkey PRIMARY KEY (id);


      --
      -- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY accounts
          ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


      --
      -- Name: accounts accounts_username_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY accounts
          ADD CONSTRAINT accounts_username_key UNIQUE (username);


      --
      -- Name: admissions admissions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY admissions
          ADD CONSTRAINT admissions_pkey PRIMARY KEY (id);


      --
      -- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY appointments
          ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


      --
      -- Name: asset_depreciation_entries asset_depreciation_entries_assetId_periodMonth_periodYear_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY asset_depreciation_entries
          ADD CONSTRAINT "asset_depreciation_entries_assetId_periodMonth_periodYear_key" UNIQUE ("assetId", "periodMonth", "periodYear");


      --
      -- Name: asset_depreciation_entries asset_depreciation_entries_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY asset_depreciation_entries
          ADD CONSTRAINT asset_depreciation_entries_pkey PRIMARY KEY (id);


      --
      -- Name: audit_records audit_records_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY audit_records
          ADD CONSTRAINT audit_records_pkey PRIMARY KEY (id);


      --
      -- Name: bed_transfers bed_transfers_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY bed_transfers
          ADD CONSTRAINT bed_transfers_pkey PRIMARY KEY (id);


      --
      -- Name: beds beds_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY beds
          ADD CONSTRAINT beds_pkey PRIMARY KEY (id);


      --
      -- Name: billing_sequences billing_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY billing_sequences
          ADD CONSTRAINT billing_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: billing_settings billing_settings_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY billing_settings
          ADD CONSTRAINT billing_settings_pkey PRIMARY KEY (id);


      --
      -- Name: clinical_notes clinical_notes_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY clinical_notes
          ADD CONSTRAINT clinical_notes_pkey PRIMARY KEY (id);


      --
      -- Name: cssd_instruments cssd_instruments_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY cssd_instruments
          ADD CONSTRAINT cssd_instruments_pkey PRIMARY KEY (id);


      --
      -- Name: cssd_sterilization_cycles cssd_sterilization_cycles_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY cssd_sterilization_cycles
          ADD CONSTRAINT cssd_sterilization_cycles_pkey PRIMARY KEY (id);


      --
      -- Name: departments departments_departmentCode_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY departments
          ADD CONSTRAINT "departments_departmentCode_key" UNIQUE ("departmentCode");


      --
      -- Name: departments departments_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY departments
          ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


      --
      -- Name: deposits deposits_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY deposits
          ADD CONSTRAINT deposits_pkey PRIMARY KEY (id);


      --
      -- Name: diagnoses diagnoses_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY diagnoses
          ADD CONSTRAINT diagnoses_pkey PRIMARY KEY (id);


      --
      -- Name: discharge_summaries discharge_summaries_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY discharge_summaries
          ADD CONSTRAINT discharge_summaries_pkey PRIMARY KEY (id);


      --
      -- Name: employee_sequences employee_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY employee_sequences
          ADD CONSTRAINT employee_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: employees employees_employeeCode_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY employees
          ADD CONSTRAINT "employees_employeeCode_key" UNIQUE ("employeeCode");


      --
      -- Name: employees employees_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY employees
          ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


      --
      -- Name: fixed_asset_categories fixed_asset_categories_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fixed_asset_categories
          ADD CONSTRAINT fixed_asset_categories_pkey PRIMARY KEY (id);


      --
      -- Name: fixed_asset_sequences fixed_asset_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fixed_asset_sequences
          ADD CONSTRAINT fixed_asset_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: fixed_assets fixed_assets_assetCode_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fixed_assets
          ADD CONSTRAINT "fixed_assets_assetCode_key" UNIQUE ("assetCode");


      --
      -- Name: fixed_assets fixed_assets_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fixed_assets
          ADD CONSTRAINT fixed_assets_pkey PRIMARY KEY (id);


      --
      -- Name: fraction_entries fraction_entries_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fraction_entries
          ADD CONSTRAINT fraction_entries_pkey PRIMARY KEY (id);


      --
      -- Name: fraction_rules fraction_rules_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY fraction_rules
          ADD CONSTRAINT fraction_rules_pkey PRIMARY KEY (id);


      --
      -- Name: helpdesk_sequences helpdesk_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY helpdesk_sequences
          ADD CONSTRAINT helpdesk_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: helpdesk_tickets helpdesk_tickets_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY helpdesk_tickets
          ADD CONSTRAINT helpdesk_tickets_pkey PRIMARY KEY (id);


      --
      -- Name: helpdesk_tickets helpdesk_tickets_ticketNumber_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY helpdesk_tickets
          ADD CONSTRAINT "helpdesk_tickets_ticketNumber_key" UNIQUE ("ticketNumber");


      --
      -- Name: insurance_claim_sequences insurance_claim_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY insurance_claim_sequences
          ADD CONSTRAINT insurance_claim_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: insurance_claims insurance_claims_claimNumber_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY insurance_claims
          ADD CONSTRAINT "insurance_claims_claimNumber_key" UNIQUE ("claimNumber");


      --
      -- Name: insurance_claims insurance_claims_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY insurance_claims
          ADD CONSTRAINT insurance_claims_pkey PRIMARY KEY (id);


      --
      -- Name: insurance_payers insurance_payers_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY insurance_payers
          ADD CONSTRAINT insurance_payers_pkey PRIMARY KEY (id);


      --
      -- Name: inventory_item_categories inventory_item_categories_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY inventory_item_categories
          ADD CONSTRAINT inventory_item_categories_pkey PRIMARY KEY (id);


      --
      -- Name: inventory_item_sub_categories inventory_item_sub_categories_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY inventory_item_sub_categories
          ADD CONSTRAINT inventory_item_sub_categories_pkey PRIMARY KEY (id);


      --
      -- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY inventory_items
          ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


      --
      -- Name: inventory_vendors inventory_vendors_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY inventory_vendors
          ADD CONSTRAINT inventory_vendors_pkey PRIMARY KEY (id);


      --
      -- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY invoice_items
          ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


      --
      -- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY invoices
          ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


      --
      -- Name: journal_entries journal_entries_journalNumber_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY journal_entries
          ADD CONSTRAINT "journal_entries_journalNumber_key" UNIQUE ("journalNumber");


      --
      -- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY journal_entries
          ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


      --
      -- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY journal_lines
          ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id);


      --
      -- Name: journal_sequences journal_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY journal_sequences
          ADD CONSTRAINT journal_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: lab_requisition_sequences lab_requisition_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_requisition_sequences
          ADD CONSTRAINT lab_requisition_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: lab_requisitions lab_requisitions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_requisitions
          ADD CONSTRAINT lab_requisitions_pkey PRIMARY KEY (id);


      --
      -- Name: lab_results lab_results_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_results
          ADD CONSTRAINT lab_results_pkey PRIMARY KEY (id);


      --
      -- Name: lab_test_categories lab_test_categories_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_test_categories
          ADD CONSTRAINT lab_test_categories_pkey PRIMARY KEY (id);


      --
      -- Name: lab_test_components lab_test_components_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_test_components
          ADD CONSTRAINT lab_test_components_pkey PRIMARY KEY (id);


      --
      -- Name: lab_tests lab_tests_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY lab_tests
          ADD CONSTRAINT lab_tests_pkey PRIMARY KEY (id);


      --
      -- Name: ledger_accounts ledger_accounts_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ledger_accounts
          ADD CONSTRAINT ledger_accounts_pkey PRIMARY KEY (id);


      --
      -- Name: maternity_records maternity_records_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY maternity_records
          ADD CONSTRAINT maternity_records_pkey PRIMARY KEY (id);


      --
      -- Name: medication_administrations medication_administrations_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY medication_administrations
          ADD CONSTRAINT medication_administrations_pkey PRIMARY KEY (id);


      --
      -- Name: nursing_tasks nursing_tasks_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY nursing_tasks
          ADD CONSTRAINT nursing_tasks_pkey PRIMARY KEY (id);


      --
      -- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY order_items
          ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


      --
      -- Name: orders orders_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY orders
          ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


      --
      -- Name: ot_sequences ot_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ot_sequences
          ADD CONSTRAINT ot_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: ot_surgeries ot_surgeries_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ot_surgeries
          ADD CONSTRAINT ot_surgeries_pkey PRIMARY KEY (id);


      --
      -- Name: ot_surgeries ot_surgeries_surgeryNumber_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ot_surgeries
          ADD CONSTRAINT "ot_surgeries_surgeryNumber_key" UNIQUE ("surgeryNumber");


      --
      -- Name: patient_addresses patient_addresses_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_addresses
          ADD CONSTRAINT patient_addresses_pkey PRIMARY KEY (id);


      --
      -- Name: patient_kins patient_kins_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_kins
          ADD CONSTRAINT patient_kins_pkey PRIMARY KEY (id);


      --
      -- Name: patient_policies patient_policies_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_policies
          ADD CONSTRAINT patient_policies_pkey PRIMARY KEY (id);


      --
      -- Name: patient_referrals patient_referrals_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_referrals
          ADD CONSTRAINT patient_referrals_pkey PRIMARY KEY (id);


      --
      -- Name: patient_sequences patient_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_sequences
          ADD CONSTRAINT patient_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: patients patients_patientNo_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patients
          ADD CONSTRAINT "patients_patientNo_key" UNIQUE ("patientNo");


      --
      -- Name: patients patients_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patients
          ADD CONSTRAINT patients_pkey PRIMARY KEY (id);


      --
      -- Name: payments payments_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY payments
          ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


      --
      -- Name: payslips payslips_employeeId_periodMonth_periodYear_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY payslips
          ADD CONSTRAINT "payslips_employeeId_periodMonth_periodYear_key" UNIQUE ("employeeId", "periodMonth", "periodYear");


      --
      -- Name: payslips payslips_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY payslips
          ADD CONSTRAINT payslips_pkey PRIMARY KEY (id);


      --
      -- Name: pharmacy_dispensing_sequences pharmacy_dispensing_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY pharmacy_dispensing_sequences
          ADD CONSTRAINT pharmacy_dispensing_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: pharmacy_dispensings pharmacy_dispensings_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY pharmacy_dispensings
          ADD CONSTRAINT pharmacy_dispensings_pkey PRIMARY KEY (id);


      --
      -- Name: prescriptions prescriptions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY prescriptions
          ADD CONSTRAINT prescriptions_pkey PRIMARY KEY (id);


      --
      -- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY purchase_order_items
          ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


      --
      -- Name: purchase_order_sequences purchase_order_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY purchase_order_sequences
          ADD CONSTRAINT purchase_order_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY purchase_orders
          ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


      --
      -- Name: radiology_imaging_items radiology_imaging_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY radiology_imaging_items
          ADD CONSTRAINT radiology_imaging_items_pkey PRIMARY KEY (id);


      --
      -- Name: radiology_imaging_types radiology_imaging_types_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY radiology_imaging_types
          ADD CONSTRAINT radiology_imaging_types_pkey PRIMARY KEY (id);


      --
      -- Name: radiology_requisition_sequences radiology_requisition_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY radiology_requisition_sequences
          ADD CONSTRAINT radiology_requisition_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: radiology_requisitions radiology_requisitions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY radiology_requisitions
          ADD CONSTRAINT radiology_requisitions_pkey PRIMARY KEY (id);


      --
      -- Name: referral_sources referral_sources_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY referral_sources
          ADD CONSTRAINT referral_sources_pkey PRIMARY KEY (id);


      --
      -- Name: returns returns_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY returns
          ADD CONSTRAINT returns_pkey PRIMARY KEY (id);


      --
      -- Name: ssu_cases ssu_cases_caseNumber_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ssu_cases
          ADD CONSTRAINT "ssu_cases_caseNumber_key" UNIQUE ("caseNumber");


      --
      -- Name: ssu_cases ssu_cases_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ssu_cases
          ADD CONSTRAINT ssu_cases_pkey PRIMARY KEY (id);


      --
      -- Name: ssu_sequences ssu_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ssu_sequences
          ADD CONSTRAINT ssu_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: stock_balances stock_balances_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_balances
          ADD CONSTRAINT stock_balances_pkey PRIMARY KEY (id);


      --
      -- Name: stock_batches stock_batches_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_batches
          ADD CONSTRAINT stock_batches_pkey PRIMARY KEY (id);


      --
      -- Name: stock_requisition_items stock_requisition_items_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_requisition_items
          ADD CONSTRAINT stock_requisition_items_pkey PRIMARY KEY (id);


      --
      -- Name: stock_requisition_sequences stock_requisition_sequences_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_requisition_sequences
          ADD CONSTRAINT stock_requisition_sequences_pkey PRIMARY KEY (prefix, year);


      --
      -- Name: stock_requisitions stock_requisitions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_requisitions
          ADD CONSTRAINT stock_requisitions_pkey PRIMARY KEY (id);


      --
      -- Name: stock_transactions stock_transactions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY stock_transactions
          ADD CONSTRAINT stock_transactions_pkey PRIMARY KEY (id);


      --
      -- Name: vaccination_records vaccination_records_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY vaccination_records
          ADD CONSTRAINT vaccination_records_pkey PRIMARY KEY (id);


      --
      -- Name: vitals vitals_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY vitals
          ADD CONSTRAINT vitals_pkey PRIMARY KEY (id);


      --
      -- Name: ward_stock_balances ward_stock_balances_departmentId_itemId_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ward_stock_balances
          ADD CONSTRAINT "ward_stock_balances_departmentId_itemId_key" UNIQUE ("departmentId", "itemId");


      --
      -- Name: ward_stock_balances ward_stock_balances_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ward_stock_balances
          ADD CONSTRAINT ward_stock_balances_pkey PRIMARY KEY (id);


      --
      -- Name: ward_stock_batches ward_stock_batches_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ward_stock_batches
          ADD CONSTRAINT ward_stock_batches_pkey PRIMARY KEY (id);


      --
      -- Name: ward_stock_transactions ward_stock_transactions_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY ward_stock_transactions
          ADD CONSTRAINT ward_stock_transactions_pkey PRIMARY KEY (id);


      --
      -- Name: wards wards_pkey; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY wards
          ADD CONSTRAINT wards_pkey PRIMARY KEY (id);


      --
      -- Name: wards wards_wardCode_key; Type: CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY wards
          ADD CONSTRAINT "wards_wardCode_key" UNIQUE ("wardCode");


      --
      -- Name: IDX_admissions_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_admissions_patientId" ON admissions USING btree ("patientId");


      --
      -- Name: IDX_admissions_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_admissions_status" ON admissions USING btree (status);


      --
      -- Name: IDX_admissions_wardId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_admissions_wardId" ON admissions USING btree ("wardId");


      --
      -- Name: IDX_appointments_appointmentDate; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_appointments_appointmentDate" ON appointments USING btree ("appointmentDate");


      --
      -- Name: IDX_appointments_departmentId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_appointments_departmentId" ON appointments USING btree ("departmentId");


      --
      -- Name: IDX_appointments_doctorId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_appointments_doctorId" ON appointments USING btree ("doctorId");


      --
      -- Name: IDX_appointments_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_appointments_status" ON appointments USING btree (status);


      --
      -- Name: IDX_audit_records_changed_by; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_audit_records_changed_by" ON audit_records USING btree ("changedByAccountId");


      --
      -- Name: IDX_audit_records_correlation_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_audit_records_correlation_id" ON audit_records USING btree ("correlationId");


      --
      -- Name: IDX_audit_records_occurred_at; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_audit_records_occurred_at" ON audit_records USING btree ("occurredAt" DESC);


      --
      -- Name: IDX_audit_records_record_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_audit_records_record_id" ON audit_records USING btree ("recordId");


      --
      -- Name: IDX_audit_records_table_name; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_audit_records_table_name" ON audit_records USING btree ("tableName");


      --
      -- Name: IDX_clinical_notes_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_clinical_notes_patientId" ON clinical_notes USING btree ("patientId");


      --
      -- Name: IDX_cssd_sterilization_cycles_instrument_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_cssd_sterilization_cycles_instrument_id" ON cssd_sterilization_cycles USING btree ("instrumentId");


      --
      -- Name: IDX_cssd_sterilization_cycles_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_cssd_sterilization_cycles_status" ON cssd_sterilization_cycles USING btree (status);


      --
      -- Name: IDX_deposits_patient_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_deposits_patient_id" ON deposits USING btree ("patientId");


      --
      -- Name: IDX_diagnoses_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_diagnoses_patientId" ON diagnoses USING btree ("patientId");


      --
      -- Name: IDX_employees_department_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_employees_department_id" ON employees USING btree ("departmentId");


      --
      -- Name: IDX_employees_employment_type; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_employees_employment_type" ON employees USING btree ("employmentType");


      --
      -- Name: IDX_helpdesk_tickets_assignee; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_helpdesk_tickets_assignee" ON helpdesk_tickets USING btree ("assigneeAccountId");


      --
      -- Name: IDX_helpdesk_tickets_created; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_helpdesk_tickets_created" ON helpdesk_tickets USING btree ("createdAt" DESC);


      --
      -- Name: IDX_helpdesk_tickets_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_helpdesk_tickets_status" ON helpdesk_tickets USING btree (status);


      --
      -- Name: IDX_inventory_item_sub_categories_category_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_inventory_item_sub_categories_category_id" ON inventory_item_sub_categories USING btree ("categoryId");


      --
      -- Name: IDX_inventory_items_sub_category_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_inventory_items_sub_category_id" ON inventory_items USING btree ("subCategoryId");


      --
      -- Name: IDX_invoice_items_invoice_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_invoice_items_invoice_id" ON invoice_items USING btree ("invoiceId");


      --
      -- Name: IDX_invoices_patient_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_invoices_patient_id" ON invoices USING btree ("patientId");


      --
      -- Name: IDX_lab_requisitions_order_item_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_lab_requisitions_order_item_id" ON lab_requisitions USING btree ("orderItemId");


      --
      -- Name: IDX_lab_results_requisition_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_lab_results_requisition_id" ON lab_results USING btree ("requisitionId");


      --
      -- Name: IDX_lab_test_components_test_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_lab_test_components_test_id" ON lab_test_components USING btree ("testId");


      --
      -- Name: IDX_lab_tests_category_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_lab_tests_category_id" ON lab_tests USING btree ("categoryId");


      --
      -- Name: IDX_maternity_records_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_maternity_records_patientId" ON maternity_records USING btree ("patientId");


      --
      -- Name: IDX_medication_administrations_admissionId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_medication_administrations_admissionId" ON medication_administrations USING btree ("admissionId");


      --
      -- Name: IDX_notifications_recipient_created; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_notifications_recipient_created" ON notifications USING btree ("recipientAccountId", "createdAt" DESC);


      --
      -- Name: IDX_notifications_recipient_unread; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_notifications_recipient_unread" ON notifications USING btree ("recipientAccountId") WHERE ("isRead" = false);


      --
      -- Name: IDX_nursing_tasks_admissionId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_nursing_tasks_admissionId" ON nursing_tasks USING btree ("admissionId");


      --
      -- Name: IDX_order_items_order_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_order_items_order_id" ON order_items USING btree ("orderId");


      --
      -- Name: IDX_ot_surgeries_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_ot_surgeries_patientId" ON ot_surgeries USING btree ("patientId");


      --
      -- Name: IDX_ot_surgeries_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_ot_surgeries_status" ON ot_surgeries USING btree (status);


      --
      -- Name: IDX_patient_referrals_patient_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_patient_referrals_patient_id" ON patient_referrals USING btree ("patientId");


      --
      -- Name: IDX_patient_referrals_source_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_patient_referrals_source_id" ON patient_referrals USING btree ("sourceId");


      --
      -- Name: IDX_payments_invoice_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_payments_invoice_id" ON payments USING btree ("invoiceId");


      --
      -- Name: IDX_pharmacy_dispensings_order_item_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_pharmacy_dispensings_order_item_id" ON pharmacy_dispensings USING btree ("orderItemId");


      --
      -- Name: IDX_prescriptions_patientId; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_prescriptions_patientId" ON prescriptions USING btree ("patientId");


      --
      -- Name: IDX_purchase_order_items_purchase_order_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_purchase_order_items_purchase_order_id" ON purchase_order_items USING btree ("purchaseOrderId");


      --
      -- Name: IDX_purchase_orders_vendor_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_purchase_orders_vendor_id" ON purchase_orders USING btree ("vendorId");


      --
      -- Name: IDX_radiology_imaging_items_imaging_type_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_radiology_imaging_items_imaging_type_id" ON radiology_imaging_items USING btree ("imagingTypeId");


      --
      -- Name: IDX_radiology_requisitions_order_item_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_radiology_requisitions_order_item_id" ON radiology_requisitions USING btree ("orderItemId");


      --
      -- Name: IDX_reporting_events_entity_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_reporting_events_entity_id" ON reporting_events USING btree ("entityId");


      --
      -- Name: IDX_reporting_events_type_occurred_at; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_reporting_events_type_occurred_at" ON reporting_events USING btree ("eventType", "occurredAt");


      --
      -- Name: IDX_returns_invoice_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_returns_invoice_id" ON returns USING btree ("invoiceId");


      --
      -- Name: IDX_stock_requisition_items_requisition_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_stock_requisition_items_requisition_id" ON stock_requisition_items USING btree ("requisitionId");


      --
      -- Name: IDX_stock_requisitions_department_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_stock_requisitions_department_id" ON stock_requisitions USING btree ("departmentId");


      --
      -- Name: IDX_stock_transactions_item_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_stock_transactions_item_id" ON stock_transactions USING btree ("itemId");


      --
      -- Name: IDX_triage_entries_status; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX "IDX_triage_entries_status" ON triage_entries USING btree (status);


      --
      -- Name: UQ_account_roles_active_assignment; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_account_roles_active_assignment" ON account_roles USING btree ("accountId", "roleId") WHERE ("isActive" = true);


      --
      -- Name: UQ_admissions_active_bed; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_admissions_active_bed" ON admissions USING btree ("bedId") WHERE ((status)::text = 'Admitted'::text);


      --
      -- Name: UQ_admissions_active_patient; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_admissions_active_patient" ON admissions USING btree ("patientId") WHERE ((status)::text = 'Admitted'::text);


      --
      -- Name: UQ_appointments_active_doctor_slot; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_appointments_active_doctor_slot" ON appointments USING btree ("doctorId", "appointmentDate", "appointmentTime") WHERE (((status)::text = 'Scheduled'::text) AND ("doctorId" IS NOT NULL));


      --
      -- Name: UQ_cssd_sterilization_cycles_active_instrument; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_cssd_sterilization_cycles_active_instrument" ON cssd_sterilization_cycles USING btree ("instrumentId") WHERE ((status)::text = 'InProgress'::text);


      --
      -- Name: UQ_discharge_summaries_admission; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_discharge_summaries_admission" ON discharge_summaries USING btree ("admissionId");


      --
      -- Name: UQ_employees_email; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_employees_email" ON employees USING btree (email) WHERE (email IS NOT NULL);


      --
      -- Name: UQ_employees_phone; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_employees_phone" ON employees USING btree (phone) WHERE (phone IS NOT NULL);


      --
      -- Name: UQ_fraction_rules_active_default_per_doctor; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_fraction_rules_active_default_per_doctor" ON fraction_rules USING btree ("doctorId") WHERE (("departmentId" IS NULL) AND ("isActive" = true));


      --
      -- Name: UQ_invoice_items_source_order_item; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_invoice_items_source_order_item" ON invoice_items USING btree ("sourceOrderItemId") WHERE ("sourceOrderItemId" IS NOT NULL);


      --
      -- Name: UQ_lab_requisitions_active_order_item; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_lab_requisitions_active_order_item" ON lab_requisitions USING btree ("orderItemId") WHERE ((status)::text <> 'Cancelled'::text);


      --
      -- Name: UQ_maternity_records_admission; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_maternity_records_admission" ON maternity_records USING btree ("admissionId");


      --
      -- Name: UQ_ot_surgeries_active_room; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_ot_surgeries_active_room" ON ot_surgeries USING btree ("otRoom") WHERE (((status)::text = 'InProgress'::text) AND ("otRoom" IS NOT NULL));


      --
      -- Name: UQ_patient_policies_patient_payer_number; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_patient_policies_patient_payer_number" ON patient_policies USING btree ("patientId", "payerId", "policyNumber");


      --
      -- Name: UQ_pharmacy_dispensings_active_order_item; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_pharmacy_dispensings_active_order_item" ON pharmacy_dispensings USING btree ("orderItemId") WHERE ((status)::text = ANY ((ARRAY['Pending'::character varying, 'Dispensed'::character varying])::text[]));


      --
      -- Name: UQ_radiology_requisitions_active_order_item; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_radiology_requisitions_active_order_item" ON radiology_requisitions USING btree ("orderItemId") WHERE ((status)::text <> 'Cancelled'::text);


      --
      -- Name: UQ_ssu_cases_active_patient; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_ssu_cases_active_patient" ON ssu_cases USING btree ("patientId") WHERE ((status)::text = 'Open'::text);


      --
      -- Name: UQ_stock_batches_item_batch_expiry; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_stock_batches_item_batch_expiry" ON stock_batches USING btree ("itemId", "batchNumber", "expiryDate") WHERE ("expiryDate" IS NOT NULL);


      --
      -- Name: UQ_stock_batches_item_batch_no_expiry; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_stock_batches_item_batch_no_expiry" ON stock_batches USING btree ("itemId", "batchNumber") WHERE ("expiryDate" IS NULL);


      --
      -- Name: UQ_vaccination_records_patient_vaccine_dose; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_vaccination_records_patient_vaccine_dose" ON vaccination_records USING btree ("patientId", lower((vaccine)::text), "doseNumber");


      --
      -- Name: UQ_ward_stock_batches_department_item_batch; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX "UQ_ward_stock_batches_department_item_batch" ON ward_stock_batches USING btree ("departmentId", "itemId", "batchNumber");


      --
      -- Name: idx_accounts_patient_id_unique; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX idx_accounts_patient_id_unique ON accounts USING btree ("patientId") WHERE ("patientId" IS NOT NULL);


      --
      -- Name: idx_journal_entries_source; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE UNIQUE INDEX idx_journal_entries_source ON journal_entries USING btree ("sourceType", "sourceId") WHERE ("sourceType" IS NOT NULL);


      --
      -- Name: idx_vitals_appointment_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX idx_vitals_appointment_id ON vitals USING btree ("appointmentId");


      --
      -- Name: idx_vitals_patient_id; Type: INDEX; Schema: tenant_squash_before; Owner: -
      --

      CREATE INDEX idx_vitals_patient_id ON vitals USING btree ("patientId");


      --
      -- Name: account_roles account_roles_accountId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY account_roles
          ADD CONSTRAINT "account_roles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES accounts(id);


      --
      -- Name: departments departments_parentDepartmentId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY departments
          ADD CONSTRAINT "departments_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES departments(id);


      --
      -- Name: patient_addresses patient_addresses_patientId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_addresses
          ADD CONSTRAINT "patient_addresses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES patients(id) ON DELETE CASCADE;


      --
      -- Name: patient_kins patient_kins_patientId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY patient_kins
          ADD CONSTRAINT "patient_kins_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES patients(id) ON DELETE CASCADE;


      --
      -- Name: vitals vitals_appointmentId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY vitals
          ADD CONSTRAINT "vitals_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES appointments(id);


      --
      -- Name: vitals vitals_patientId_fkey; Type: FK CONSTRAINT; Schema: tenant_squash_before; Owner: -
      --

      ALTER TABLE ONLY vitals
          ADD CONSTRAINT "vitals_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES patients(id);


      --
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op — see the class doc comment.
  }
}
