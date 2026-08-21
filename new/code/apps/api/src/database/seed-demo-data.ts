import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EntityManager } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AppModule } from '../app/app.module.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { PatientsService } from '../patients/patients.service.js';
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
import { Patient } from '../patients/entities/patient.entity.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';

const logger = new Logger('SeedDemoData');

function demoId(): string {
  return process.env['MASTER_ADMIN_TENANT_ID'] ?? 'demo';
}

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
 * Idempotent: if the demo schema already has any patients, seeding is skipped.
 */
export async function seedDemoData(): Promise<void> {
  const tenantId = demoId();
  if (tenantId === PLATFORM_TENANT_ID) {
    throw new Error('Demo seeding is not allowed against the platform tenant');
  }

  const app: INestApplicationContext = await NestFactory.createApplicationContext(AppModule, {
    // Keep app-boot noise out, but let the seeding Logger lines through.
    logger: ['log', 'warn', 'error'],
  });
  try {
    const tenantContext = app.get(TenantContextService);
    const tenantConnection = app.get(TenantConnectionService);

    const tenantProvisioning = app.get(TenantProvisioningService);
    await tenantProvisioning.provisionTenantSchema(tenantId);

    await tenantContext.run(
      { tenantId, correlationId: 'seed-demo-data' },
      async () => {
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
        const masterData = app.get(MasterDataService);
        const inventoryCatalog = app.get(InventoryCatalogService);
        const inventoryProcurement = app.get(InventoryProcurementService);
        const labCatalog = app.get(LabCatalogService);
        const labWorkflow = app.get(LabWorkflowService);
        const radiologyCatalog = app.get(RadiologyCatalogService);
        const radiologyWorkflow = app.get(RadiologyWorkflowService);
        const pharmacy = app.get(PharmacyDispensingService);
        const orders = app.get(OrdersService);
        const employeesService = app.get(EmployeeService);
        const payroll = app.get(PayrollService);

        const DOCTOR_ID = '00000000-0000-0000-0000-0000000000e1';

        // --- Ward + beds ---------------------------------------------------------------------
        const ward = await masterData.createWard({
          wardCode: 'W-GEN',
          wardName: 'General Ward',
          wardType: 'General',
          bedCapacity: 20,
        });
        const bed1 = await masterData.createBed({ wardId: ward.id, bedNumber: 'G-101', bedType: 'General' });
        await masterData.createBed({ wardId: ward.id, bedNumber: 'G-102', bedType: 'General' });

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
          bedId: bed1.id,
        });

        // --- Inventory stock for pharmacy ------------------------------------------------------
        const pharmaCat = await inventoryCatalog.createCategory({ name: 'Pharmaceuticals' });
        const analgesics = await inventoryCatalog.createSubCategory({
          categoryId: pharmaCat.id,
          name: 'Analgesics',
          isConsumable: true,
        });
        const paracetamol = await inventoryCatalog.createItem({
          subCategoryId: analgesics.id,
          name: 'Paracetamol 500mg',
          code: 'PARA-500',
          unitOfMeasure: 'tablet',
          reorderLevel: 100,
          minimumStock: 50,
          salePrice: 2,
        });
        const vendor = await inventoryCatalog.createVendor({ name: 'MediSupply Co', phone: '011-40000001' });
        const po = await inventoryProcurement.createPurchaseOrder({
          vendorId: vendor.id,
          items: [{ itemId: paracetamol.id, orderedQuantity: 500, unitCost: 1 }],
          orderedBy: DOCTOR_ID,
        });
        await inventoryProcurement.recordGoodsReceipt(po.items[0].id, {
          batchNumber: 'DEMO-B001',
          expiryDate: '2027-12-31',
          unitCost: 1,
          receivedQuantity: 500,
          recordedBy: DOCTOR_ID,
        });

        // --- Lab catalog ------------------------------------------------------------------------
        const hemaCat = await labCatalog.createCategory({ name: 'Hematology' });
        const cbc = await labCatalog.createTest({
          categoryId: hemaCat.id,
          name: 'Complete Blood Count',
          code: 'CBC',
          specimenType: 'Blood',
          price: 300,
        });
        const hb = await labCatalog.createComponent(cbc.id, { name: 'Hemoglobin', unit: 'g/dL' });

        // --- Radiology catalog -------------------------------------------------------------------
        const xrayType = await radiologyCatalog.createType({ name: 'X-Ray' });
        const chestXray = await radiologyCatalog.createItem({
          imagingTypeId: xrayType.id,
          name: 'Chest X-Ray PA',
          procedureCode: 'XR-CHEST',
          price: 450,
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
          testId: cbc.id,
          specimenType: 'Blood',
        });
        await labWorkflow.collectSample(labReq.id);
        await labWorkflow.enterResult(labReq.id, { componentId: hb.id, value: '13.2', enteredBy: DOCTOR_ID });
        await labWorkflow.verify(labReq.id, DOCTOR_ID);

        const radioReq = await radiologyWorkflow.createRequisition({
          orderItemId: radioItem.id,
          imagingItemId: chestXray.id,
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
          inventoryItemId: paracetamol.id,
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
      },
    );
  } finally {
    await app.close();
  }
}
