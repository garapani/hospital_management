import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AppModule } from '../app/app.module.js';
import { getDemoHospitalAdminConfig } from './seed-initial-setup.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { SubscriptionBillingService } from '../platform-billing/subscription-billing.service.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { VitalsService } from '../clinical/vitals/vitals.service.js';
import { EncountersService } from '../clinical/encounters/encounters.service.js';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { MasterDataService } from '../master-data/master-data.service.js';
import { InventoryCatalogService } from '../inventory/inventory-catalog.service.js';
import { InventoryProcurementService } from '../inventory/inventory-procurement.service.js';
import { LabCatalogService } from '../lab/lab-catalog.service.js';
import { LabWorkflowService } from '../lab/lab-workflow.service.js';
import { RadiologyCatalogService } from '../radiology/radiology-catalog.service.js';
import { RadiologyWorkflowService } from '../radiology/radiology-workflow.service.js';
import { PharmacyDispensingService } from '../pharmacy/pharmacy-dispensing.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { EmployeeService } from '../employee/employee.service.js';
import { PayrollService } from '../payroll/payroll.service.js';
import { InsuranceClaimsService } from '../insurance/insurance-claims.service.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';

const logger = new Logger('SeedDemoData');


/**
 * Seeds realistic demo data for the demo hospital so the MVP launch/demo isn't an empty shell:
 * a ward with beds, patients, appointments, a full visit record (vitals + encounter), an
 * admission, an order whose Lab/Pharmacy/Radiology items are driven through completion — which
 * exercises the REAL charge-capture subscriber into a patient invoice — plus employees and a
 * payroll run.
 *
 * The app is booted (not services hand-wired) precisely so the charge-capture and notification
 * subscribers are live; the seed would otherwise silently skip auto-billing.
 *
 * Idempotent: staff accounts are ensured on every run (skipped when the username already exists);
 * the business data is only seeded when the demo schema has no patients yet.
 */

/** Demo staff accounts: one per operational role so every Basic feature has a working login. */
const DEMO_STAFF: Array<{
  username: string;
  roleName: string;
  displayName: string;
  password?: string;
}> = [
  {
    username: 'nurseuser',
    roleName: 'Nurse',
    displayName: 'Demo Nurse',
    password: process.env['DEMO_NURSE_PASSWORD'] ?? 'Nurseuser@123!',
  },
  {
    username: 'doctoruser',
    roleName: 'Doctor',
    displayName: 'Demo Doctor',
    password: process.env['DEMO_DOCTOR_PASSWORD'] ?? 'Doctoruser@123!',
  },
  {
    username: 'receptionist',
    roleName: 'Receptionist / Front Desk',
    displayName: 'Demo Receptionist',
    password: process.env['DEMO_RECEPTIONIST_PASSWORD'] ?? 'Receptionist@123!',
  },
  {
    username: 'accountuser',
    roleName: 'Billing/Accounts Staff',
    displayName: 'Demo Accounts Staff',
    password: process.env['DEMO_ACCOUNT_PASSWORD'] ?? 'Accountuser@123!',
  },
  { username: 'demo.doctor', roleName: 'Doctor', displayName: 'Demo Doctor' },
  { username: 'demo.lab', roleName: 'Lab Technician', displayName: 'Demo Lab Technician' },
  { username: 'demo.radiology', roleName: 'Radiology Technician', displayName: 'Demo Radiology Technician' },
  { username: 'demo.pharmacy', roleName: 'Pharmacist', displayName: 'Demo Pharmacist' },
  { username: 'demo.inventory', roleName: 'Inventory/Store Manager', displayName: 'Demo Inventory Manager' },
  { username: 'demo.billing', roleName: 'Billing/Accounts Staff', displayName: 'Demo Billing Staff' },
  { username: 'demo.nurse', roleName: 'Nurse', displayName: 'Demo Nurse' },
  { username: 'demo.helpdesk', roleName: 'Helpdesk Agent', displayName: 'Demo Helpdesk Agent' },
  { username: 'demo.hr', roleName: 'HR/Payroll Admin', displayName: 'Demo HR/Payroll Admin' },
  { username: 'demo.audit', roleName: 'Auditor/Compliance', displayName: 'Demo Auditor' },
];

export function demoStaffPassword(): string {
  return process.env['DEMO_STAFF_PASSWORD'] ?? 'Demo@123!';
}

/**
 * Ensures reference/catalog data exists — ward+beds, a department, the inventory item catalog,
 * lab test catalog, and radiology catalog, plus insurance payers. Idempotent per entry (checked by
 * its own natural key: code, or name where there's no code), independent of whether the tenant
 * already has patients/orders/etc. — unlike seedDemoData's business-data block below (gated behind
 * "no patients yet"), this is safe to call on every run, including a demo tenant that's already
 * been used for manual testing. Must run inside an active TenantContextService.run(...) call, same
 * as every other tenant-scoped service call in this file.
 */
export async function seedCatalogData(app: INestApplicationContext) {
  const masterData = app.get(MasterDataService);
  const inventoryCatalog = app.get(InventoryCatalogService);
  const labCatalog = app.get(LabCatalogService);
  const radiologyCatalog = app.get(RadiologyCatalogService);
  const insuranceClaims = app.get(InsuranceClaimsService);

  // --- Ward + beds -----------------------------------------------------------------------
  let ward = (await masterData.listWards({})).data.find((w) => w.wardCode === 'W-GEN');
  if (!ward) {
    ward = await masterData.createWard({ wardCode: 'W-GEN', wardName: 'General Ward', wardType: 'General', bedCapacity: 20 });
    logger.log('✓ Created ward: General Ward (W-GEN)');
  }
  const existingBeds = (await masterData.listBedsByWard(ward.id, {})).data;
  let bed1 = existingBeds.find((b) => b.bedNumber === 'G-101');
  if (!bed1) {
    bed1 = await masterData.createBed({ wardId: ward.id, bedNumber: 'G-101', bedType: 'General' });
  }
  let bed2 = existingBeds.find((b) => b.bedNumber === 'G-102');
  if (!bed2) {
    bed2 = await masterData.createBed({ wardId: ward.id, bedNumber: 'G-102', bedType: 'General' });
  }

  // --- Department --------------------------------------------------------------------------
  if (!(await masterData.listDepartments({})).data.some((d) => d.departmentCode === 'GEN-MED')) {
    await masterData.createDepartment({ departmentCode: 'GEN-MED', departmentName: 'General Medicine', isAppointmentApplicable: true });
    logger.log('✓ Created department: General Medicine (GEN-MED)');
  }

  // --- Inventory catalog ---------------------------------------------------------------------
  let pharmaCat = (await inventoryCatalog.listCategories()).find((c) => c.name === 'Pharmaceuticals');
  if (!pharmaCat) {
    pharmaCat = await inventoryCatalog.createCategory({ name: 'Pharmaceuticals' });
  }
  let analgesics = (await inventoryCatalog.listSubCategoriesByCategory(pharmaCat.id, {})).data.find((s) => s.name === 'Analgesics');
  if (!analgesics) {
    analgesics = await inventoryCatalog.createSubCategory({ categoryId: pharmaCat.id, name: 'Analgesics', isConsumable: true });
  }
  let paracetamol = (await inventoryCatalog.listItemsBySubCategory(analgesics.id, {})).data.find((i) => i.code === 'PARA-500');
  if (!paracetamol) {
    paracetamol = await inventoryCatalog.createItem({
      subCategoryId: analgesics.id,
      name: 'Paracetamol 500mg',
      code: 'PARA-500',
      unitOfMeasure: 'tablet',
      reorderLevel: 100,
      minimumStock: 50,
      salePrice: 2,
    });
  }
  let vendor = (await inventoryCatalog.listVendors({})).data.find((v) => v.name === 'MediSupply Co');
  if (!vendor) {
    vendor = await inventoryCatalog.createVendor({ name: 'MediSupply Co', phone: '011-40000001' });
  }

  // --- Lab catalog -----------------------------------------------------------------------
  let hemaCat = (await labCatalog.listCategories()).find((c) => c.name === 'Hematology');
  if (!hemaCat) {
    hemaCat = await labCatalog.createCategory({ name: 'Hematology' });
  }
  let cbc = (await labCatalog.listTestsByCategory(hemaCat.id)).find((t) => t.code === 'CBC');
  if (!cbc) {
    cbc = await labCatalog.createTest({ categoryId: hemaCat.id, name: 'Complete Blood Count', code: 'CBC', specimenType: 'Blood', price: 300 });
  }
  let hb = (await labCatalog.listComponentsByTest(cbc.id)).find((c) => c.name === 'Hemoglobin');
  if (!hb) {
    // Numeric range set (unlike the original demo seed) so the Enter Results screen's entry-time
    // abnormal-range warning has real data to demonstrate against.
    hb = await labCatalog.createComponent(cbc.id, { name: 'Hemoglobin', unit: 'g/dL', referenceRangeLow: 12, referenceRangeHigh: 16 });
  }

  // --- Radiology catalog -------------------------------------------------------------------
  let xrayType = (await radiologyCatalog.listTypes()).find((t) => t.name === 'X-Ray');
  if (!xrayType) {
    xrayType = await radiologyCatalog.createType({ name: 'X-Ray' });
  }
  let chestXray = (await radiologyCatalog.listItemsByType(xrayType.id)).find((i) => i.procedureCode === 'XR-CHEST');
  if (!chestXray) {
    chestXray = await radiologyCatalog.createItem({ imagingTypeId: xrayType.id, name: 'Chest X-Ray PA', procedureCode: 'XR-CHEST', price: 450 });
  }

  // --- Insurance payers --------------------------------------------------------------------
  const existingPayers = await insuranceClaims.listPayers();
  if (!existingPayers.some((p) => p.name === 'CGHS')) {
    await insuranceClaims.createPayer({ name: 'CGHS', type: 'Government' });
    logger.log('✓ Created insurance payer: CGHS (Government)');
  }
  if (!existingPayers.some((p) => p.name === 'Star Health')) {
    await insuranceClaims.createPayer({ name: 'Star Health', type: 'Private' });
    logger.log('✓ Created insurance payer: Star Health (Private)');
  }

  logger.log('✓ Catalog/reference data ensured: ward+beds, department, inventory catalog, lab catalog, radiology catalog, insurance payers.');

  return { ward, bed1, bed2, pharmaCat, analgesics, paracetamol, vendor, hemaCat, cbc, hb, xrayType, chestXray };
}

/**
 * Boots the app, ensures the demo tenant's schema is provisioned, and runs `work` inside its
 * tenant context — the boilerplate shared by every demo-seeding entry point (seedDemoData,
 * seedDemoCatalog). Booting the real app (not hand-wiring services) matters here: it keeps the
 * charge-capture and notification subscribers live, so business-data seeding doesn't silently skip
 * auto-billing.
 */
async function bootAndRunInDemoTenant(correlationId: string, work: (app: INestApplicationContext) => Promise<void>): Promise<void> {
  const demoConfig = getDemoHospitalAdminConfig();
  const tenantId = demoConfig.tenantId;
  if (tenantId === PLATFORM_TENANT_ID) {
    throw new Error('Demo seeding is not allowed against the platform tenant');
  }

  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
    // Keep app-boot noise out, but let the seeding Logger lines through.
    logger: ['log', 'warn', 'error'],
  });
  try {
    const tenantContext = app.get(TenantContextService);
    const tenantProvisioning = app.get(TenantProvisioningService);
    await tenantProvisioning.provisionTenantSchema(tenantId);

    await tenantContext.run({ tenantId, correlationId }, () => work(app));
  } finally {
    await app.close();
  }
}

/** Seeds only the reference/catalog data (ward+beds, department, inventory/lab/radiology
 *  catalogs, insurance payers) — safe to run standalone, any time, including against a demo
 *  tenant that already has patients/orders from manual testing. See seedCatalogData's own doc
 *  comment for exactly what it covers and its idempotency guarantee. */
export async function seedDemoCatalog(): Promise<void> {
  await bootAndRunInDemoTenant('seed-demo-catalog', async (app) => {
    await seedCatalogData(app);
  });
}

export async function seedDemoData(): Promise<void> {
  const demoConfig = getDemoHospitalAdminConfig();
  const tenantId = demoConfig.tenantId;
  await bootAndRunInDemoTenant('seed-demo-data', async (app) => {
    const tenantConnection = app.get(TenantConnectionService);

    {
        // Staff accounts are ensured on every run (idempotent per username) so the demo always
        // has role-appropriate logins for every Basic feature, even after a data re-seed.
        const accounts = app.get(AccountsService);
        for (const staff of DEMO_STAFF) {
          const existing = await accounts.findByUsernameWithRoles(staff.username);
          if (existing) {
            continue;
          }
          await accounts.createStaffAccount({
            username: staff.username,
            email: `${staff.username}@hospital.local`,
            displayName: staff.displayName,
            password: staff.password ?? demoStaffPassword(),
            roleName: staff.roleName,
            needsPasswordUpdate: false,
          });
          logger.log(`✓ Created demo staff account: ${staff.username} (${staff.roleName})`);
        }

        // --- SaaS Subscription & Invoice -----------------------------------------------------------
        const dataSource = app.get(DataSource);
        const tenantRepo = dataSource.getRepository(Tenant);
        // hospitalName/packageCode come from the same getDemoHospitalAdminConfig() seed-initial-
        // setup.ts uses — this seeder previously hardcoded its own divergent copy ('Demo
        // Hospital'/'basic' vs the canonical 'enterprise'), and since a tenant registry row is
        // never reconciled once it exists (only created if absent), running this seeder before
        // seed-initial-setup on a fresh environment permanently pinned the demo tenant to Basic,
        // silently hiding the Lab/Radiology/Inventory data this very seeder creates behind
        // PackagesService.filterPermissions's module gating.
        let demoTenant = await tenantRepo.findOne({ where: { hospitalId: tenantId } });
        if (!demoTenant) {
          demoTenant = tenantRepo.create({
            hospitalId: tenantId,
            hospitalName: demoConfig.hospitalName,
            status: 'active',
            packageCode: demoConfig.packageCode,
            activatedAt: new Date(),
          });
          await tenantRepo.save(demoTenant);
        }

        const billing = app.get(SubscriptionBillingService);
        const existingSub = await billing.getSubscription(tenantId);
        if (!existingSub) {
          await billing.subscribe(tenantId, 'monthly');
          await billing.issueInvoice(tenantId);
          logger.log(`✓ Seeded SaaS subscription & open invoice for tenant: ${tenantId}`);
        }

        // Reference/catalog data is ensured unconditionally, before the patient-count gate below —
        // it's idempotent per entry and independent of whether business data has already been
        // seeded, unlike everything from here down.
        const catalog = await seedCatalogData(app);

        // Count must run inside the tenant schema — a bare repository count() queries the
        // default search_path (public) and would see the legacy public tables, not the demo.
        const existingCount = await tenantConnection.runInTenantSchema((manager: EntityManager) =>
          manager.getRepository(Patient).count(),
        );
        if (existingCount > 0) {
          logger.log(`Demo tenant already has ${existingCount} patients — skipping demo seeding.`);
          return;
        }

        const patients = app.get(PatientsService);
        const appointments = app.get(AppointmentsService);
        const vitals = app.get(VitalsService);
        const encounters = app.get(EncountersService);
        const admissions = app.get(AdmissionsService);
        const inventoryProcurement = app.get(InventoryProcurementService);
        const labWorkflow = app.get(LabWorkflowService);
        const radiologyWorkflow = app.get(RadiologyWorkflowService);
        const pharmacy = app.get(PharmacyDispensingService);
        const orders = app.get(OrdersService);
        const employeesService = app.get(EmployeeService);
        const payroll = app.get(PayrollService);

        const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e1';

        // --- Patients ------------------------------------------------------------------------
        const anita = await patients.create({
          firstName: 'Anita',
          lastName: 'Sharma',
          gender: 'Female',
          dateOfBirth: '1985-04-12',
          phoneNumber: '9811000001',
        });
        const ravi = await patients.create({
          firstName: 'Ravi',
          lastName: 'Kumar',
          gender: 'Male',
          dateOfBirth: '1978-11-02',
          phoneNumber: '9811000002',
        });
        const meera = await patients.create({
          firstName: 'Meera',
          lastName: 'Iyer',
          gender: 'Female',
          dateOfBirth: '1992-06-25',
          phoneNumber: '9811000003',
        });

        // --- Appointments ---------------------------------------------------------------------
        await appointments.create({
          patientId: anita.id,
          firstName: anita.firstName,
          lastName: anita.lastName,
          contactNumber: anita.phoneNumber ?? '',
          appointmentDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          appointmentTime: '10:30',
          appointmentType: 'OPD',
          reason: 'Fever and cough',
        });
        await appointments.create({
          patientId: meera.id,
          firstName: meera.firstName,
          lastName: meera.lastName,
          contactNumber: meera.phoneNumber ?? '',
          appointmentDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
          appointmentTime: '11:00',
          appointmentType: 'FollowUp',
          reason: 'Diabetes follow-up',
        });

        // --- Visit record: vitals + encounter (note, diagnosis, prescription) ------------------
        await vitals.create({
          patientId: anita.id,
          temperature: 38.4,
          pulse: 92,
          bpSystolic: 120,
          bpDiastolic: 80,
          respiratoryRate: 20,
          spO2: 97,
          painScale: 2,
        });
        await encounters.createNote({
          patientId: anita.id,
          doctorId: DOCTOR_ID,
          chiefComplaint: 'Fever and cough for 3 days',
          historyOfPresentingIllness: 'Low-grade fever, dry cough, no breathlessness.',
          physicalExamination: 'Throat congested, chest clear.',
          plan: 'CBC, paracetamol; review in 3 days',
        });
        await encounters.createDiagnosis({
          patientId: anita.id,
          doctorId: DOCTOR_ID,
          description: 'Acute upper respiratory tract infection',
          isPrimary: true,
        });
        await encounters.createPrescription({
          patientId: anita.id,
          doctorId: DOCTOR_ID,
          medicationName: 'Paracetamol 500mg',
          dosage: '500 mg',
          frequency: '1-0-1',
          route: 'Oral',
          durationDays: 3,
        });

        // --- Admission ------------------------------------------------------------------------
        await admissions.admit({
          patientId: ravi.id,
          admissionSource: 'OPD',
          admittingDoctorId: DOCTOR_ID,
          bedId: catalog.bed1.id,
        });

        // --- Inventory stock for pharmacy (catalog itself is seeded by seedCatalogData above) ---
        const po = await inventoryProcurement.createPurchaseOrder({
          vendorId: catalog.vendor.id,
          items: [{ itemId: catalog.paracetamol.id, orderedQuantity: 500, unitCost: 1 }],
          orderedBy: DOCTOR_ID,
        });
        await inventoryProcurement.recordGoodsReceipt(po.items[0].id, {
          batchNumber: 'DEMO-B001',
          expiryDate: '2027-12-31',
          unitCost: 1,
          receivedQuantity: 500,
          recordedBy: DOCTOR_ID,
        });

        // --- Order + complete all three items (drives charge-capture into an invoice) ------------
        const order = await orders.create({
          patientId: anita.id,
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
        await labWorkflow.enterResult(labReq.id, { componentId: catalog.hb.id, value: '13.2', enteredBy: DOCTOR_ID });
        await labWorkflow.verify(labReq.id, DOCTOR_ID);

        const radioReq = await radiologyWorkflow.createRequisition({
          orderItemId: radioItem.id,
          imagingItemId: catalog.chestXray.id,
        });
        await radiologyWorkflow.markScanned(radioReq.id, DOCTOR_ID);
        await radiologyWorkflow.enterReport(radioReq.id, {
          reportText: 'No acute cardiopulmonary abnormality.',
          indication: 'Fever and cough',
          reportEnteredBy: DOCTOR_ID,
        });
        await radiologyWorkflow.verify(radioReq.id, DOCTOR_ID);

        const dispensing = await pharmacy.createDispensing({
          orderItemId: pharmaItem.id,
          inventoryItemId: catalog.paracetamol.id,
          quantity: 10,
        });
        await pharmacy.dispenseDrug(dispensing.id, { dispensedBy: DOCTOR_ID });

        // --- Employees + payroll -------------------------------------------------------------------
        await employeesService.createEmployee({
          firstName: 'Kiran',
          lastName: 'Joshi',
          joinDate: '2024-01-15',
          employmentType: 'FullTime',
          monthlyBasicSalary: 25000,
          designation: 'Staff Nurse',
        });
        await employeesService.createEmployee({
          firstName: 'Amit',
          lastName: 'Verma',
          joinDate: '2023-06-01',
          employmentType: 'FullTime',
          monthlyBasicSalary: 80000,
          designation: 'Consultant Physician',
        });
        const now = new Date();
        const payslips = await payroll.runMonthlyPayroll(now.getMonth() + 1, now.getFullYear(), { processedBy: DOCTOR_ID });

        logger.log(
          `Demo data seeded: 3 patients, 2 appointments, 1 admission, 1 completed order (charge-captured to an invoice), ` +
            `2 employees, ${payslips.length} payslip(s).`,
        );
    }
  });
}
