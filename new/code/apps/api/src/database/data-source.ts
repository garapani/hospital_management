import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { Package } from '../packages/entities/package.entity.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { DepartmentCatalog } from '../master-data/entities/department-catalog.entity.js';
import { Ward } from '../master-data/entities/ward.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { PatientAddress } from '../patients/entities/patient-address.entity.js';
import { PatientKin } from '../patients/entities/patient-kin.entity.js';
import { PatientSequence } from '../patients/entities/patient-sequence.entity.js';
import { Appointment } from '../appointments/entities/appointment.entity.js';
import { Vital } from '../clinical/vitals/entities/vital.entity.js';
import { ClinicalNote } from '../clinical/encounters/entities/clinical-note.entity.js';
import { Diagnosis } from '../clinical/encounters/entities/diagnosis.entity.js';
import { Prescription } from '../clinical/encounters/entities/prescription.entity.js';
import { TriageEntry } from '../clinical/triage/entities/triage-entry.entity.js';
import { Bed } from '../master-data/entities/bed.entity.js';
import { Admission } from '../admissions/entities/admission.entity.js';
import { BedTransfer } from '../admissions/entities/bed-transfer.entity.js';
import { DischargeSummary } from '../admissions/entities/discharge-summary.entity.js';
import { FixedAssetCategory } from '../fixed-assets/entities/fixed-asset-category.entity.js';
import { FixedAsset } from '../fixed-assets/entities/fixed-asset.entity.js';
import { AssetDepreciationEntry } from '../fixed-assets/entities/asset-depreciation-entry.entity.js';
import { InsurancePayer } from '../insurance/entities/insurance-payer.entity.js';
import { PatientPolicy } from '../insurance/entities/patient-policy.entity.js';
import { InsuranceClaim } from '../insurance/entities/insurance-claim.entity.js';
import { LedgerAccount } from '../accounting/entities/ledger-account.entity.js';
import { JournalEntry, JournalLine } from '../accounting/entities/journal-entry.entity.js';
import { WardStockBalance, WardStockBatch, WardStockTransaction } from '../ward-supply/entities/ward-stock.entity.js';
import { NursingTask, MedicationAdministration } from '../nursing/entities/nursing.entity.js';
import { OtSurgery } from '../ot/entities/ot-surgery.entity.js';
import { MaternityRecord } from '../maternity/entities/maternity-record.entity.js';
import { CssdInstrument, CssdSterilizationCycle } from '../cssd/entities/cssd.entity.js';
import { Employee } from '../employee/entities/employee.entity.js';
import { Payslip } from '../payroll/entities/payslip.entity.js';
import { FractionRule, FractionEntry } from '../fraction/entities/fraction.entity.js';
import { HelpdeskTicket } from '../helpdesk/entities/helpdesk-ticket.entity.js';
import { ReferralSource, PatientReferral } from '../marketing/entities/marketing.entity.js';
import { SsuCase } from '../ssu/entities/ssu-case.entity.js';
import { VaccinationRecord } from '../vaccination/entities/vaccination-record.entity.js';
import { Subscription } from '../platform-billing/entities/subscription.entity.js';
import { SubscriptionInvoice } from '../platform-billing/entities/subscription-invoice.entity.js';
import { TenantBranding } from '../platform-branding/entities/tenant-branding.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { BillingSettings } from '../billing/entities/billing-settings.entity.js';
import { BillingSequence } from '../billing/entities/billing-sequence.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { InvoiceItem } from '../billing/entities/invoice-item.entity.js';
import { Payment } from '../billing/entities/payment.entity.js';
import { Deposit } from '../billing/entities/deposit.entity.js';
import { Return } from '../billing/entities/return.entity.js';
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { LabTestCategory } from '../lab/entities/lab-test-category.entity.js';
import { LabTest } from '../lab/entities/lab-test.entity.js';
import { LabTestComponent } from '../lab/entities/lab-test-component.entity.js';
import { LabRequisition } from '../lab/entities/lab-requisition.entity.js';
import { LabResult } from '../lab/entities/lab-result.entity.js';
import { RadiologyImagingType } from '../radiology/entities/radiology-imaging-type.entity.js';
import { RadiologyImagingItem } from '../radiology/entities/radiology-imaging-item.entity.js';
import { RadiologyRequisition } from '../radiology/entities/radiology-requisition.entity.js';
import { InventoryItemCategory } from '../inventory/entities/inventory-item-category.entity.js';
import { InventoryItemSubCategory } from '../inventory/entities/inventory-item-sub-category.entity.js';
import { InventoryItem } from '../inventory/entities/inventory-item.entity.js';
import { InventoryVendor } from '../inventory/entities/inventory-vendor.entity.js';
import { PurchaseOrder } from '../inventory/entities/purchase-order.entity.js';
import { PurchaseOrderItem } from '../inventory/entities/purchase-order-item.entity.js';
import { StockBatch } from '../inventory/entities/stock-batch.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { StockTransaction } from '../inventory/entities/stock-transaction.entity.js';
import { StockRequisition } from '../inventory/entities/stock-requisition.entity.js';
import { StockRequisitionItem } from '../inventory/entities/stock-requisition-item.entity.js';
import { PharmacyDispensing } from '../pharmacy/entities/pharmacy-dispensing.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';
import { PLATFORM_MIGRATIONS } from './migrations/index.js';

const logger = new Logger('DataSource');

export function createDataSource(): DataSource {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [Role, Permission, RolePermission, Package, Account, AccountRole, Tenant, AuditRecord, DepartmentCatalog, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer, DischargeSummary, Order, OrderItem, BillingSettings, BillingSequence, Invoice, InvoiceItem, Payment, Deposit, Return, ReportingEvent, LabTestCategory, LabTest, LabTestComponent, LabRequisition, LabResult, RadiologyImagingType, RadiologyImagingItem, RadiologyRequisition, InventoryItemCategory, InventoryItemSubCategory, InventoryItem, InventoryVendor, PurchaseOrder, PurchaseOrderItem, StockBatch, StockBalance, StockTransaction, StockRequisition, StockRequisitionItem, PharmacyDispensing, Notification, FixedAssetCategory, FixedAsset, AssetDepreciationEntry, InsurancePayer, PatientPolicy, InsuranceClaim, LedgerAccount, JournalEntry, JournalLine, WardStockBalance, WardStockBatch, WardStockTransaction, NursingTask, MedicationAdministration, OtSurgery, MaternityRecord, CssdInstrument, CssdSterilizationCycle, Employee, Payslip, FractionRule, FractionEntry, HelpdeskTicket, ReferralSource, PatientReferral, SsuCase, VaccinationRecord, Subscription, SubscriptionInvoice, TenantBranding],
    migrations: PLATFORM_MIGRATIONS,
    synchronize: false,
    // Bounds connection acquisition so pool exhaustion fails fast (a thrown, catchable error)
    // instead of queuing forever — node-postgres defaults to connectionTimeoutMillis: 0 (wait
    // indefinitely), which turns sustained overload into a silent, unbounded stall.
    //
    // max/statement_timeout are both first-class `pg` Pool/Client options — pg issues
    // `SET statement_timeout` itself right after connecting, no raw-SQL workaround needed (unlike
    // search_path, which pg has no first-class option for — see tenant-migration-data-source.ts).
    // Defaults here are a placeholder pending the real load test PRD.md §12 open question #1
    // still calls for; both are env-tunable without a code change once that number is known.
    extra: {
      connectionTimeoutMillis: Number(process.env['DB_CONNECTION_TIMEOUT_MS'] ?? 15000),
      max: Number(process.env['DB_POOL_MAX'] ?? 20),
      statement_timeout: Number(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? 30000),
    },
  });

  // Add periodic pool monitoring for observability
  if (process.env['NODE_ENV'] !== 'test') {
    const monitorPool = () => {
      try {
        const pool = (ds.driver as any).queryRunner?.connection?.pool;
        if (pool) {
          const pendingCount = pool.pendingCount ?? 0;
          const activeCount = pool.activeCount ?? 0;
          const idleCount = pool.idleCount ?? 0;
          const totalCount = pool.max ?? Number(process.env['DB_POOL_MAX'] ?? 20);
          
          logger.log(`DB Pool Stats: active=${activeCount}, idle=${idleCount}, pending=${pendingCount}, max=${totalCount}`);
          
          // Log warning if pool is near exhaustion
          if (pendingCount > 0 || activeCount > totalCount * 0.8) {
            logger.warn(`DB Pool approaching capacity: ${activeCount}/${totalCount} active, ${pendingCount} pending`);
          }
        }
      } catch (error) {
        logger.debug('Unable to read pool stats', error);
      }
    };

    // Monitor every 30 seconds after initialization
    setTimeout(() => {
      monitorPool();
      setInterval(monitorPool, 30000);
    }, 5000);
  }

  return ds;
}

export const dataSource = createDataSource();
