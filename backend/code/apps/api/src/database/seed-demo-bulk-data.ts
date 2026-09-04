import { INestApplicationContext, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { bootAndRunInDemoTenant, seedCatalogData } from './seed-demo-data.js';
import { getDemoHospitalAdminConfig } from './seed-initial-setup.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { VitalsService } from '../clinical/vitals/vitals.service.js';
import { EncountersService } from '../clinical/encounters/encounters.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { InventoryProcurementService } from '../inventory/inventory-procurement.service.js';
import { LabWorkflowService } from '../lab/lab-workflow.service.js';
import { RadiologyWorkflowService } from '../radiology/radiology-workflow.service.js';
import { PharmacyDispensingService } from '../pharmacy/pharmacy-dispensing.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { StockBalance } from '../inventory/entities/stock-balance.entity.js';
import { Invoice } from '../billing/entities/invoice.entity.js';

const logger = new Logger('SeedDemoBulkData');

const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e1';

/**
 * Extra QA volume for the demo tenant, layered on top of `seedDemoData`'s onboarding seed rather
 * than replacing it — that seed gates itself off entirely once the tenant has any patients, so a
 * re-run against an already-used demo tenant is a no-op. This is idempotent per record (a patient
 * is skipped if its phone number already exists) instead of gated on "has any data at all", so
 * it's safe to run repeatedly against a QA environment that's already been used for manual
 * testing — same idempotency shape as `seedCatalogData`.
 *
 * Phone numbers 9811001001-9811001020 are reserved for this seeder (the onboarding seed uses
 * 9811000001-9811000003) — don't reuse this range for anything else.
 */
const BULK_PATIENTS: Array<{ firstName: string; lastName: string; gender: string; dateOfBirth: string }> = [
  { firstName: 'Priya', lastName: 'Nair', gender: 'Female', dateOfBirth: '1990-03-14' },
  { firstName: 'Arjun', lastName: 'Menon', gender: 'Male', dateOfBirth: '1982-07-22' },
  { firstName: 'Sunita', lastName: 'Reddy', gender: 'Female', dateOfBirth: '1975-01-30' },
  { firstName: 'Vikram', lastName: 'Singh', gender: 'Male', dateOfBirth: '1988-09-05' },
  { firstName: 'Kavita', lastName: 'Rao', gender: 'Female', dateOfBirth: '1995-12-11' },
  { firstName: 'Rajesh', lastName: 'Gupta', gender: 'Male', dateOfBirth: '1968-05-19' },
  { firstName: 'Deepa', lastName: 'Pillai', gender: 'Female', dateOfBirth: '2000-02-28' },
  { firstName: 'Manoj', lastName: 'Chauhan', gender: 'Male', dateOfBirth: '1979-10-08' },
  { firstName: 'Lakshmi', lastName: 'Krishnan', gender: 'Female', dateOfBirth: '1958-06-17' },
  { firstName: 'Sanjay', lastName: 'Patel', gender: 'Male', dateOfBirth: '1991-04-23' },
  { firstName: 'Neha', lastName: 'Joshi', gender: 'Female', dateOfBirth: '1986-08-02' },
  { firstName: 'Ashok', lastName: 'Yadav', gender: 'Male', dateOfBirth: '1972-11-14' },
  { firstName: 'Rekha', lastName: 'Bose', gender: 'Female', dateOfBirth: '1998-03-09' },
  { firstName: 'Suresh', lastName: 'Nambiar', gender: 'Male', dateOfBirth: '1965-07-27' },
  { firstName: 'Anjali', lastName: 'Kapoor', gender: 'Female', dateOfBirth: '1993-01-16' },
  { firstName: 'Deepak', lastName: 'Mishra', gender: 'Male', dateOfBirth: '1980-09-30' },
  { firstName: 'Pooja', lastName: 'Desai', gender: 'Female', dateOfBirth: '1987-05-06' },
  { firstName: 'Ramesh', lastName: 'Iyer', gender: 'Male', dateOfBirth: '1955-12-25' },
  { firstName: 'Swati', lastName: 'Agarwal', gender: 'Female', dateOfBirth: '2002-06-19' },
  { firstName: 'Vinod', lastName: 'Thakur', gender: 'Male', dateOfBirth: '1970-02-11' },
];

const APPOINTMENT_TYPES = ['OPD', 'FollowUp', 'Emergency'];
const APPOINTMENT_REASONS = [
  'Fever and body ache',
  'Routine checkup',
  'Diabetes follow-up',
  'Hypertension review',
  'Cough and cold',
  'Post-surgery review',
  'Skin rash',
  'Joint pain',
];

async function findExistingPatientByPhone(
  tenantConnection: TenantConnectionService,
  phoneNumber: string,
): Promise<Patient | null> {
  return tenantConnection.runInTenantSchema((manager: EntityManager) =>
    manager.getRepository(Patient).findOne({ where: { phoneNumber } }),
  );
}

/** Tops up paracetamol stock when it's running low — gated on the current balance, not a batch
 *  number, so it's safe to call on every seeder run without over-receiving stock indefinitely. */
async function ensurePharmacyStock(
  app: INestApplicationContext,
  tenantConnection: TenantConnectionService,
  paracetamolId: string,
  vendorId: string,
): Promise<void> {
  const totalAvailable = await tenantConnection.runInTenantSchema(async (manager: EntityManager) => {
    const balances = await manager.getRepository(StockBalance).find({ where: { itemId: paracetamolId } });
    return balances.reduce((sum, b) => sum + Number(b.availableQuantity), 0);
  });
  if (totalAvailable >= 200) {
    return;
  }
  const inventoryProcurement = app.get(InventoryProcurementService);
  const po = await inventoryProcurement.createPurchaseOrder({
    vendorId,
    items: [{ itemId: paracetamolId, orderedQuantity: 1000, unitCost: 1 }],
    orderedBy: DOCTOR_ID,
  });
  await inventoryProcurement.recordGoodsReceipt(po.items[0].id, {
    batchNumber: `DEMO-BULK-${Date.now()}`,
    expiryDate: '2028-12-31',
    unitCost: 1,
    receivedQuantity: 1000,
    recordedBy: DOCTOR_ID,
  });
  logger.log('✓ Topped up paracetamol stock by 1000 units for the bulk seed.');
}

/** Ensures 3 more beds exist beyond the catalog's bed1/bed2 — 5 admissions each need their own
 *  bed (only 2 of the 5 get discharged), so reusing bed1/bed2 across all 5 would double-book a
 *  bed still occupied by an earlier, non-discharged admission. Idempotent per bed number, same
 *  as `seedCatalogData`'s own beds. */
async function ensureExtraBeds(app: INestApplicationContext, wardId: string) {
  const masterData = app.get(MasterDataService);
  const existingBeds = (await masterData.listBedsByWard(wardId, {})).data;
  const numbers = ['G-103', 'G-104', 'G-105'];
  const beds = [];
  for (const bedNumber of numbers) {
    let bed = existingBeds.find((b) => b.bedNumber === bedNumber);
    if (!bed) {
      bed = await masterData.createBed({ wardId, bedNumber, bedType: 'General' });
    }
    beds.push(bed);
  }
  return beds;
}

/** Full visit: vitals + encounter (note/diagnosis/prescription) + a Lab+Radiology+Pharmacy order
 *  taken through completion, which drives the real charge-capture subscriber into an invoice —
 *  the same single-patient workflow `seedDemoData` demonstrates once, reused here across many
 *  patients so accounts/nursing/doctor QA has real volume to work with. */
async function seedFullVisit(
  app: INestApplicationContext,
  patient: Patient,
  catalog: Awaited<ReturnType<typeof seedCatalogData>>,
): Promise<Invoice> {
  const vitals = app.get(VitalsService);
  const encounters = app.get(EncountersService);
  const orders = app.get(OrdersService);
  const labWorkflow = app.get(LabWorkflowService);
  const radiologyWorkflow = app.get(RadiologyWorkflowService);
  const pharmacy = app.get(PharmacyDispensingService);
  const invoicesService = app.get(InvoicesService);

  await vitals.create({
    patientId: patient.id,
    temperature: Math.round((36.5 + Math.random() * 2) * 10) / 10,
    pulse: 70 + Math.floor(Math.random() * 30),
    bpSystolic: 110 + Math.floor(Math.random() * 20),
    bpDiastolic: 70 + Math.floor(Math.random() * 15),
    respiratoryRate: 16 + Math.floor(Math.random() * 6),
    spO2: 95 + Math.floor(Math.random() * 4),
    painScale: Math.floor(Math.random() * 4),
  });
  await encounters.createNote({
    patientId: patient.id,
    doctorId: DOCTOR_ID,
    chiefComplaint: 'Routine visit',
    historyOfPresentingIllness: 'No acute complaints, follow-up visit.',
    physicalExamination: 'Within normal limits.',
    plan: 'CBC, chest X-ray, symptomatic medication.',
  });
  await encounters.createDiagnosis({
    patientId: patient.id,
    doctorId: DOCTOR_ID,
    description: 'General health check',
    isPrimary: true,
  });
  await encounters.createPrescription({
    patientId: patient.id,
    doctorId: DOCTOR_ID,
    medicationName: 'Paracetamol 500mg',
    dosage: '500 mg',
    frequency: '1-0-1',
    route: 'Oral',
    durationDays: 3,
  });

  const order = await orders.create({
    patientId: patient.id,
    orderedBy: DOCTOR_ID,
    items: [
      { itemType: 'Lab', itemDescription: 'Complete Blood Count' },
      { itemType: 'Pharmacy', itemDescription: 'Paracetamol 500mg x10' },
      { itemType: 'Radiology', itemDescription: 'Chest X-Ray PA' },
    ],
  });
  const labItem = order.items.find((i) => i.itemType === 'Lab')!;
  const pharmaItem = order.items.find((i) => i.itemType === 'Pharmacy')!;
  const radioItem = order.items.find((i) => i.itemType === 'Radiology')!;

  const labReq = await labWorkflow.createRequisition({
    orderItemId: labItem.id,
    testId: catalog.cbc.id,
    specimenType: 'Blood',
  });
  await labWorkflow.collectSample(labReq.id);
  await labWorkflow.enterResult(labReq.id, { componentId: catalog.hb.id, value: '13.5', enteredBy: DOCTOR_ID });
  await labWorkflow.verify(labReq.id, DOCTOR_ID);

  const radioReq = await radiologyWorkflow.createRequisition({
    orderItemId: radioItem.id,
    imagingItemId: catalog.chestXray.id,
  });
  await radiologyWorkflow.markScanned(radioReq.id, DOCTOR_ID);
  await radiologyWorkflow.enterReport(radioReq.id, {
    reportText: 'No acute abnormality.',
    indication: 'Routine visit',
    reportEnteredBy: DOCTOR_ID,
  });
  await radiologyWorkflow.verify(radioReq.id, DOCTOR_ID);

  const dispensing = await pharmacy.createDispensing({
    orderItemId: pharmaItem.id,
    inventoryItemId: catalog.paracetamol.id,
    quantity: 10,
  });
  await pharmacy.dispenseDrug(dispensing.id, { dispensedBy: DOCTOR_ID });

  const invoices = await invoicesService.list({ patientId: patient.id, page: 1, limit: 1 });
  const invoice = invoices.data[0];
  if (!invoice) {
    throw new Error(`Invariant violation: no invoice found for patient ${patient.id} after order completion`);
  }
  return invoice;
}

export async function seedDemoBulkData(): Promise<void> {
  await bootAndRunInDemoTenant('seed-demo-bulk-data', async (app) => {
    // bootAndRunInDemoTenant's own tenantContext.run() sets tenantId/correlationId but no
    // accountId (matching seedDemoData's original, narrower needs) — some calls this seeder makes
    // (InvoicesService.cancel, notably: unlike recordPayment/createReturn it has no non-HTTP
    // actor-fallback parameter at all) resolve their actor purely from
    // TenantContextService.getAccountId(), so without one they'd insert a NULL into a NOT NULL
    // "createdBy" column. Re-entering tenantContext.run() here, nested inside the outer one, adds
    // an accountId for the rest of this function without touching the shared helper's contract for
    // seedDemoData (which never needed one).
    const tenantContext = app.get(TenantContextService);
    const demoTenantId = getDemoHospitalAdminConfig().tenantId;
    await tenantContext.run(
      { tenantId: demoTenantId, accountId: DOCTOR_ID, correlationId: 'seed-demo-bulk-data' },
      () => runBulkSeed(app),
    );
  });
}

async function runBulkSeed(app: INestApplicationContext): Promise<void> {
  const tenantConnection = app.get(TenantConnectionService);
  const patients = app.get(PatientsService);
  const appointments = app.get(AppointmentsService);
  const admissions = app.get(AdmissionsService);
  const invoicesService = app.get(InvoicesService);

  const catalog = await seedCatalogData(app);
  await ensurePharmacyStock(app, tenantConnection, catalog.paracetamol.id, catalog.vendor.id);

  // --- Patients (idempotent per phone number) -------------------------------------------
  const createdPatients: Patient[] = [];
  const isNewlyCreated: boolean[] = [];
  let createdCount = 0;
  for (let i = 0; i < BULK_PATIENTS.length; i++) {
    const phoneNumber = `981100${String(1001 + i)}`;
    const existing = await findExistingPatientByPhone(tenantConnection, phoneNumber);
    if (existing) {
      createdPatients.push(existing);
      isNewlyCreated.push(false);
      continue;
    }
    const def = BULK_PATIENTS[i];
    const patient = await patients.create({
      firstName: def.firstName,
      lastName: def.lastName,
      gender: def.gender,
      dateOfBirth: def.dateOfBirth,
      phoneNumber,
    });
    createdPatients.push(patient);
    isNewlyCreated.push(true);
    createdCount += 1;
  }
  logger.log(`Patients: ${createdCount} created, ${BULK_PATIENTS.length - createdCount} already existed (${BULK_PATIENTS.length} total).`);

  // --- Appointments (one per newly-created patient, spread over the next 20 days) --------
  // Only for patients this run just created — an already-existing patient (from a prior run)
  // may already have appointments from that earlier run, and appointments have no natural
  // unique key to check against, so re-creating one for an existing patient would duplicate it.
  let appointmentsCreated = 0;
  for (let i = 0; i < createdPatients.length; i++) {
    if (!isNewlyCreated[i]) continue;
    const patient = createdPatients[i];
    const daysOut = 1 + (i % 20);
    await appointments.create({
      patientId: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      contactNumber: patient.phoneNumber ?? '',
      appointmentDate: new Date(Date.now() + daysOut * 86400000).toISOString().slice(0, 10),
      appointmentTime: `${String(9 + (i % 8)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
      appointmentType: APPOINTMENT_TYPES[i % APPOINTMENT_TYPES.length],
      reason: APPOINTMENT_REASONS[i % APPOINTMENT_REASONS.length],
    });
    appointmentsCreated += 1;
  }
  logger.log(`Appointments: ${appointmentsCreated} created.`);

  // --- Full visits (vitals + encounter + order → invoice) for the first 10 patients, with a
  //     spread of billing states for accounts-role QA -------------------------------------
  // visitInvoices ends up with exactly one invoice per visitPatients[i], regardless of whether
  // it was created just now or already existed from an earlier (possibly interrupted) run — the
  // payment-state loop below keys off this array's indices, not "was it created this run", so a
  // re-run after a crash mid-way still applies the full Unpaid/PartiallyPaid/Paid/Returned/
  // Cancelled spread instead of silently leaving whatever invoices survived the crash untouched.
  const visitPatients = createdPatients.slice(0, 10);
  const visitInvoices: Invoice[] = [];
  let invoicesCreatedCount = 0;
  for (const patient of visitPatients) {
    const existing = (await invoicesService.list({ patientId: patient.id, page: 1, limit: 1 })).data[0];
    if (existing) {
      visitInvoices.push(existing);
      continue;
    }
    visitInvoices.push(await seedFullVisit(app, patient, catalog));
    invoicesCreatedCount += 1;
  }

  // Apply a spread of billing states by index — skipped per-invoice if it's already past its
  // fresh Unpaid/zero-paid state, so this is idempotent whether the invoice is brand new this
  // run or survived from an earlier interrupted one.
  for (let i = 0; i < visitInvoices.length; i++) {
    const invoice = visitInvoices[i];
    if (invoice.status !== 'Unpaid' || invoice.paidAmount > 0) {
      continue; // Already has a state applied (from this run or an earlier one) — don't reapply.
    }
    if (i < 3) {
      continue; // Unpaid — no payment recorded.
    } else if (i < 6) {
      // PartiallyPaid — half the total.
      await invoicesService.recordPayment(invoice.id, {
        amount: Math.round((invoice.totalAmount / 2) * 100) / 100,
        paymentMode: 'Cash',
        receivedBy: DOCTOR_ID,
      });
    } else if (i < 8) {
      // Paid in full.
      await invoicesService.recordPayment(invoice.id, {
        amount: invoice.totalAmount,
        paymentMode: 'Card',
        receivedBy: DOCTOR_ID,
      });
    } else if (i === 8) {
      // Paid in full, then a partial return (credit note) — exercises the returns workflow.
      await invoicesService.recordPayment(invoice.id, {
        amount: invoice.totalAmount,
        paymentMode: 'UPI',
        receivedBy: DOCTOR_ID,
      });
      await invoicesService.createReturn(invoice.id, {
        amount: Math.round(invoice.totalAmount * 0.2 * 100) / 100,
        reason: 'Overcharge correction (demo return)',
        returnedBy: DOCTOR_ID,
      });
    } else {
      // Cancelled before any payment.
      await invoicesService.cancel(invoice.id);
    }
  }
  logger.log(
    `Full visits/invoices: ${invoicesCreatedCount} created (${visitInvoices.length} total), with a spread of Unpaid/PartiallyPaid/Paid/Returned/Cancelled states.`,
  );

  // --- Admissions for the next 5 patients (2 discharged) ----------------------------------
  const admissionPatients = createdPatients.slice(10, 15);
  const extraBeds = await ensureExtraBeds(app, catalog.ward.id);
  const beds = [catalog.bed1, catalog.bed2, ...extraBeds];
  let admissionsCreated = 0;
  for (let i = 0; i < admissionPatients.length; i++) {
    const patient = admissionPatients[i];
    const alreadyAdmitted = (await admissions.list({ patientId: patient.id, page: 1, limit: 1 })).meta.total > 0;
    if (alreadyAdmitted) {
      continue;
    }
    const admission = await admissions.admit({
      patientId: patient.id,
      admissionSource: i % 2 === 0 ? 'OPD' : 'Emergency',
      admittingDoctorId: DOCTOR_ID,
      bedId: beds[i].id,
    });
    if (i < 2) {
      await admissions.discharge(admission.id, {
        dischargedBy: DOCTOR_ID,
        dischargeType: 'Routine',
        dischargeCondition: 'Stable',
      });
    }
    admissionsCreated += 1;
  }
  logger.log(`Admissions: ${admissionsCreated} created (2 discharged, rest still admitted).`);

  logger.log(
    `Bulk demo data seed complete: ${BULK_PATIENTS.length} patients ensured, ${appointmentsCreated} new appointments, ` +
      `${invoicesCreatedCount} new full visits/invoices, ${admissionsCreated} new admissions.`,
  );
}
