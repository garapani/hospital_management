import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
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
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { BillingSettings } from '../billing/entities/billing-settings.entity.js';
import { BillingSequence } from '../billing/entities/billing-sequence.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';
import { InvoiceItem } from '../billing/entities/invoice-item.entity.js';
import { Payment } from '../billing/entities/payment.entity.js';
import { Deposit } from '../billing/entities/deposit.entity.js';
import { ReportingEvent } from '../reporting/entities/reporting-event.entity.js';
import { CreateRbacCatalogTables } from './migrations/0001-create-rbac-catalog-tables.js';
import { AddRolePermissionsUniqueConstraint } from './migrations/0003-add-role-permissions-unique-constraint.js';
import { CreateTenantsTable } from './migrations/0005-create-tenants-table.js';
import { CreatePatientTables005 } from './migrations/005_create_patient_tables.js';
import { CreateVitalsTable0010 } from './migrations/0010-create-vitals-table.js';
import { CreateTriageTable0012 } from './migrations/0012-create-triage-table.js';
import { CreateBedsTable0013 } from './migrations/0013-create-beds-table.js';
import { CreateAdmissionsTables0014 } from './migrations/0014-create-admissions-tables.js';
import { CreateOrdersTables0015 } from './migrations/0015-create-orders-tables.js';
import { CreateBillingTables0016 } from './migrations/0016-create-billing-tables.js';
import { CreateReportingTables0017 } from './migrations/0017-create-reporting-tables.js';

export function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'] ?? 'localhost',
    port: Number(process.env['DB_PORT'] ?? 5433),
    username: process.env['DB_USERNAME'] ?? 'identity_access',
    password: process.env['DB_PASSWORD'] ?? 'identity_access_dev_password',
    database: process.env['DB_DATABASE'] ?? 'identity_access',
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord, Department, Ward, Patient, PatientAddress, PatientKin, PatientSequence, Appointment, Vital, ClinicalNote, Diagnosis, Prescription, TriageEntry, Bed, Admission, BedTransfer, Order, OrderItem, BillingSettings, BillingSequence, Invoice, InvoiceItem, Payment, Deposit, ReportingEvent],
    migrations: [CreateRbacCatalogTables, AddRolePermissionsUniqueConstraint, CreateTenantsTable, CreatePatientTables005, CreateVitalsTable0010, CreateTriageTable0012, CreateBedsTable0013, CreateAdmissionsTables0014, CreateOrdersTables0015, CreateBillingTables0016, CreateReportingTables0017],
    synchronize: false,
  });
}

export const dataSource = createDataSource();
