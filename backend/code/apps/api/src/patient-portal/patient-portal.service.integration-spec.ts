import { NotFoundException } from '@nestjs/common';
import { PdfService } from '@hospital/pdf';
import { ObjectStorageService } from '@hospital/object-storage';
import { PatientPortalService } from './patient-portal.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AppointmentsService } from '../appointments/appointments.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { EncountersService } from '../clinical/encounters/encounters.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { LabWorkflowService } from '../lab/lab-workflow.service.js';
import { LabCatalogService } from '../lab/lab-catalog.service.js';
import { LabRequisitionNumberGeneratorService } from '../lab/lab-requisition-number-generator.service.js';
import { RadiologyWorkflowService } from '../radiology/radiology-workflow.service.js';
import { RadiologyCatalogService } from '../radiology/radiology-catalog.service.js';
import { RadiologyRequisitionNumberGeneratorService } from '../radiology/radiology-requisition-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

const DOCTOR_ID = '00000000-0000-4000-8000-0000000000e3';
const STAFF_ACCOUNT_ID = '00000000-0000-4000-8000-0000000000e4';

describe('PatientPortalService (integration)', () => {
  let ctx: TenantTestContext;
  let portalService: PatientPortalService;
  let patientsService: PatientsService;
  let ordersService: OrdersService;
  let labWorkflowService: LabWorkflowService;
  let labCatalogService: LabCatalogService;
  let radiologyWorkflowService: RadiologyWorkflowService;
  let radiologyCatalogService: RadiologyCatalogService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'patient_portal' });
    portalService = new PatientPortalService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(
      ctx.tenantConnection,
      new PatientNumberGeneratorService(ctx.tenantConnection),
      new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext),
      new PdfService(),
    );
    ordersService = new OrdersService(ctx.tenantConnection);
    labCatalogService = new LabCatalogService(ctx.tenantConnection);
    labWorkflowService = new LabWorkflowService(
      ctx.tenantConnection,
      new LabRequisitionNumberGeneratorService(ctx.tenantConnection),
      labCatalogService,
      ordersService,
      patientsService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
    radiologyCatalogService = new RadiologyCatalogService(ctx.tenantConnection);
    radiologyWorkflowService = new RadiologyWorkflowService(
      ctx.tenantConnection,
      new RadiologyRequisitionNumberGeneratorService(ctx.tenantConnection),
      radiologyCatalogService,
      ordersService,
      ctx.tenantContext,
      new PdfService(),
      new ObjectStorageService(),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function inPatientContext<T>(patientId: string, work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run({ tenantId: ctx.tenantId, patientId, correlationId: 'test' }, work);
  }

  // Fixture setup needs a staff accountId in context: several actor-derived NOT NULL columns
  // (invoices.createdBy, lab_results.enteredBy, ...) are populated from
  // tenantContext.getAccountId(), which plain ctx.inTenant() deliberately leaves unset — mirrors
  // the withActor() helper already established in invoices/lab-workflow's own integration specs.
  function withStaffActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: STAFF_ACCOUNT_ID, correlationId: 'test' },
      work,
    );
  }

  async function makePatient(firstName: string) {
    return withStaffActor(() =>
      patientsService.create({ firstName, lastName: 'Portal', gender: 'Female' }),
    );
  }

  // Every fixture below is deliberately created for TWO patients (A and B) in the same tenant —
  // scoping-by-tenant is already covered elsewhere; what this suite exists to prove is that a
  // patient-portal caller only ever sees rows for the ONE patientId in its own JWT-derived
  // context, never another patient's, within the same tenant schema.
  it('scopes appointments, invoices, and prescriptions to the calling patient only', async () => {
    const [patientA, patientB] = await Promise.all([makePatient('Alpha'), makePatient('Beta')]);

    await withStaffActor(async () => {
      const appointmentsService = new AppointmentsService(ctx.tenantConnection);
      await appointmentsService.create({
        patientId: patientA.id,
        firstName: patientA.firstName,
        lastName: patientA.lastName,
        contactNumber: '9000000001',
        appointmentDate: '2026-09-01',
        appointmentTime: '10:00',
        appointmentType: 'OPD',
      });
      await appointmentsService.create({
        patientId: patientB.id,
        firstName: patientB.firstName,
        lastName: patientB.lastName,
        contactNumber: '9000000002',
        appointmentDate: '2026-09-01',
        appointmentTime: '11:00',
        appointmentType: 'OPD',
      });

      const invoicesService = new InvoicesService(
        ctx.tenantConnection,
        ctx.tenantContext,
        new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext),
      );
      await invoicesService.create({
        patientId: patientA.id,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
      });
      await invoicesService.create({
        patientId: patientB.id,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
      });

      const encountersService = new EncountersService(ctx.tenantConnection, ctx.tenantContext);
      await encountersService.createPrescription({
        patientId: patientA.id,
        doctorId: DOCTOR_ID,
        medicationName: 'Paracetamol',
        dosage: '500mg',
        frequency: 'BD',
        route: 'Oral',
        durationDays: 5,
      });
      await encountersService.createPrescription({
        patientId: patientB.id,
        doctorId: DOCTOR_ID,
        medicationName: 'Ibuprofen',
        dosage: '200mg',
        frequency: 'TDS',
        route: 'Oral',
        durationDays: 3,
      });
    });

    const [appointmentsA, invoicesA, prescriptionsA] = await inPatientContext(patientA.id, () =>
      Promise.all([
        portalService.listAppointments(),
        portalService.listInvoices(),
        portalService.listPrescriptions(),
      ]),
    );

    expect(appointmentsA.data).toHaveLength(1);
    expect(appointmentsA.data[0].patientId).toBe(patientA.id);
    expect(invoicesA.data).toHaveLength(1);
    expect(invoicesA.data[0].patientId).toBe(patientA.id);
    expect(prescriptionsA.data).toHaveLength(1);
    expect(prescriptionsA.data[0].medicationName).toBe('Paracetamol');

    const appointmentsB = await inPatientContext(patientB.id, () => portalService.listAppointments());
    expect(appointmentsB.data).toHaveLength(1);
    expect(appointmentsB.data[0].patientId).toBe(patientB.id);
  });

  it('returns only verified lab and radiology results, scoped to the calling patient', async () => {
    const [patientA, patientB] = await Promise.all([
      makePatient('Verified'),
      makePatient('Other'),
    ]);

    const { labTest, component } = await withStaffActor(async () => {
      const category = await labCatalogService.createCategory({ name: `Cat ${Date.now()}` });
      const labTest = await labCatalogService.createTest({
        categoryId: category.id,
        name: 'Complete Blood Count',
        code: `CBC-${Date.now()}`,
        specimenType: 'Blood',
      });
      const component = await labCatalogService.createComponent(labTest.id, { name: 'Hemoglobin', unit: 'g/dL' });
      return { labTest, component };
    });

    const { imagingItem } = await withStaffActor(async () => {
      const imagingType = await radiologyCatalogService.createType({ name: `X-Ray ${Date.now()}` });
      const imagingItem = await radiologyCatalogService.createItem({
        imagingTypeId: imagingType.id,
        name: 'Chest X-Ray',
      });
      return { imagingItem };
    });

    async function buildVerifiedLabResult(patientId: string, value: string) {
      return withStaffActor(async () => {
        const order = await ordersService.create({
          patientId,
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Lab', itemDescription: 'CBC' }],
        });
        const orderItem = order.items[0];
        const requisition = await labWorkflowService.createRequisition({
          orderItemId: orderItem.id,
          testId: labTest.id,
          specimenType: 'Blood',
        });
        await labWorkflowService.collectSample(requisition.id);
        await labWorkflowService.enterResult(requisition.id, { componentId: component.id, value });
        return labWorkflowService.verify(requisition.id);
      });
    }

    async function buildUnverifiedLabResult(patientId: string) {
      return withStaffActor(async () => {
        const order = await ordersService.create({
          patientId,
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Lab', itemDescription: 'CBC pending' }],
        });
        const orderItem = order.items[0];
        const requisition = await labWorkflowService.createRequisition({
          orderItemId: orderItem.id,
          testId: labTest.id,
          specimenType: 'Blood',
        });
        // Left at 'Pending' — sample not yet collected, results not yet entered or verified.
        return requisition;
      });
    }

    async function buildVerifiedRadiologyResult(patientId: string, reportText: string) {
      return withStaffActor(async () => {
        const order = await ordersService.create({
          patientId,
          orderedBy: DOCTOR_ID,
          items: [{ itemType: 'Radiology', itemDescription: 'Chest X-Ray' }],
        });
        const orderItem = order.items[0];
        const requisition = await radiologyWorkflowService.createRequisition({
          orderItemId: orderItem.id,
          imagingItemId: imagingItem.id,
        });
        await radiologyWorkflowService.markScanned(requisition.id);
        await radiologyWorkflowService.enterReport(requisition.id, { reportText });
        return radiologyWorkflowService.verify(requisition.id);
      });
    }

    await buildVerifiedLabResult(patientA.id, '13.5');
    await buildUnverifiedLabResult(patientA.id);
    await buildVerifiedLabResult(patientB.id, '9.0');
    await buildVerifiedRadiologyResult(patientA.id, 'No acute findings.');
    await buildVerifiedRadiologyResult(patientB.id, 'Unrelated finding.');

    const resultsA = await inPatientContext(patientA.id, () => portalService.listResults());

    const labResultsA = resultsA.data.filter((r) => r.type === 'lab');
    const radiologyResultsA = resultsA.data.filter((r) => r.type === 'radiology');

    expect(labResultsA).toHaveLength(1);
    expect(labResultsA[0].value).toBe('13.5');
    expect(labResultsA[0].componentName).toBe('Hemoglobin');

    expect(radiologyResultsA).toHaveLength(1);
    expect(radiologyResultsA[0].reportText).toBe('No acute findings.');

    // Never patient B's values, and never the unverified pending requisition.
    expect(resultsA.data.some((r) => r.value === '9.0')).toBe(false);
    expect(resultsA.data.some((r) => r.reportText === 'Unrelated finding.')).toBe(false);
  });

  it('getMe returns the calling patient\'s own basic profile', async () => {
    const patient = await makePatient('Self');
    const me = await inPatientContext(patient.id, () => portalService.getMe());
    expect(me.id).toBe(patient.id);
    expect(me.firstName).toBe('Self');
  });

  it('getMe rejects a deactivated patient even with an otherwise-valid patient context', async () => {
    const patient = await makePatient('Deactivated');
    await withStaffActor(() => patientsService.deactivate(patient.id));

    await expect(inPatientContext(patient.id, () => portalService.getMe())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects every list endpoint for a deactivated patient, not just getMe', async () => {
    const patient = await makePatient('DeactivatedLists');
    await withStaffActor(() => patientsService.deactivate(patient.id));

    await expect(inPatientContext(patient.id, () => portalService.listAppointments())).rejects.toThrow(
      NotFoundException,
    );
    await expect(inPatientContext(patient.id, () => portalService.listInvoices())).rejects.toThrow(
      NotFoundException,
    );
    await expect(inPatientContext(patient.id, () => portalService.listPrescriptions())).rejects.toThrow(
      NotFoundException,
    );
    await expect(inPatientContext(patient.id, () => portalService.listResults())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('excludes internal staff-only fields (audit columns, internal notes) from the appointment/invoice views', async () => {
    const patient = await makePatient('Projection');

    const appointment = await withStaffActor(async () => {
      const appointmentsService = new AppointmentsService(ctx.tenantConnection);
      const created = await appointmentsService.create({
        patientId: patient.id,
        firstName: patient.firstName,
        lastName: patient.lastName,
        contactNumber: '9000000099',
        appointmentDate: '2026-09-05',
        appointmentTime: '09:00',
        appointmentType: 'OPD',
      });
      // Sets cancelledRemarks — an internal front-desk note the finding flags as leaked.
      return appointmentsService.cancel(created.id, 'Front-desk-only cancellation note');
    });
    expect(appointment.cancelledRemarks).toBe('Front-desk-only cancellation note');

    await withStaffActor(() => {
      const invoicesService = new InvoicesService(
        ctx.tenantConnection,
        ctx.tenantContext,
        new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext),
      );
      return invoicesService.create({
        patientId: patient.id,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
      });
    });

    const appointmentsView = await inPatientContext(patient.id, () => portalService.listAppointments());
    const invoicesView = await inPatientContext(patient.id, () => portalService.listInvoices());

    const appointmentView = appointmentsView.data.find((a) => a.id === appointment.id) as unknown as Record<
      string,
      unknown
    >;
    expect(appointmentView).toBeDefined();
    expect(appointmentView.patientId).toBe(patient.id); // legitimate fields still present
    expect(appointmentView.cancelledRemarks).toBeUndefined();
    expect(appointmentView.createdBy).toBeUndefined();
    expect(appointmentView.updatedBy).toBeUndefined();

    const invoiceView = invoicesView.data[0] as unknown as Record<string, unknown>;
    expect(invoiceView.totalAmount).toBeDefined(); // legitimate field still present
    expect(invoiceView.notes).toBeUndefined();
    expect(invoiceView.createdBy).toBeUndefined();
    expect(invoiceView.updatedBy).toBeUndefined();
  });

  it('paginates listAppointments', async () => {
    const patient = await makePatient('Paginated');
    await withStaffActor(async () => {
      const appointmentsService = new AppointmentsService(ctx.tenantConnection);
      for (let i = 0; i < 3; i++) {
        await appointmentsService.create({
          patientId: patient.id,
          firstName: patient.firstName,
          lastName: patient.lastName,
          contactNumber: `900000010${i}`,
          appointmentDate: '2026-09-10',
          appointmentTime: `1${i}:00`,
          appointmentType: 'OPD',
        });
      }
    });

    const page1 = await inPatientContext(patient.id, () =>
      portalService.listAppointments({ page: 1, limit: 2 }),
    );
    expect(page1.data).toHaveLength(2);
    expect(page1.meta.total).toBe(3);
    expect(page1.meta.totalPages).toBe(2);
  });
});
