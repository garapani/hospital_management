import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { InvoicesService } from './invoices.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';

describe('InvoicesService (integration)', () => {
  const dataSource = createDataSource();
  let tenantConnection: TenantConnectionService;
  let tenantContextService: TenantContextService;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;

  let tenantId1: string;
  let tenantId2: string;

  beforeAll(async () => {
    await dataSource.initialize();

    tenantContextService = new TenantContextService();
    tenantConnection = new TenantConnectionService(dataSource, tenantContextService);
    const accountsService = new AccountsService(tenantConnection, dataSource);
    const tenantsService = new TenantsService(dataSource);
    const patientSequence = new PatientNumberGeneratorService(tenantConnection);
    patientsService = new PatientsService(tenantConnection, patientSequence);
    invoicesService = new InvoicesService(tenantConnection);

    const uniqueId = Date.now().toString();
    const t1 = await tenantsService.provisionTenant({ hospitalId: `invoices_1_${uniqueId}`, hospitalName: 'Invoices Hospital 1' });
    tenantId1 = t1.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId1);

    const t2 = await tenantsService.provisionTenant({ hospitalId: `invoices_2_${uniqueId}`, hospitalName: 'Invoices Hospital 2' });
    tenantId2 = t2.hospitalId;
    await accountsService.provisionTenantSchema(dataSource, tenantId2);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return tenantContextService.run({ tenantId, correlationId: 'test' }, work);
  }

  async function makePatient(tenantId: string, phoneNumber: string) {
    return inTenant(tenantId, () =>
      patientsService.create({
        firstName: 'Test',
        lastName: 'Patient',
        dateOfBirth: '1990-01-01',
        gender: 'Male',
        phoneNumber,
      }),
    );
  }

  const STAFF_ID = '00000000-0000-0000-0000-0000000000f1';

  it('creates an invoice with mixed taxable and exempt items, correctly split into CGST/SGST', async () => {
    const patient = await makePatient(tenantId1, '5550000001');
    const invoice = await inTenant(tenantId1, () =>
      invoicesService.create({
        patientId: patient.id,
        createdBy: STAFF_ID,
        items: [
          { description: 'Consultation Fee', unitPrice: 500, taxPercent: 0 },
          { description: 'Paracetamol 500mg x10', unitPrice: 100, quantity: 2, taxPercent: 12, hsnSacCode: '30049099' },
        ],
      }),
    );

    expect(invoice.items).toHaveLength(2);
    expect(invoice.subtotal).toBe(700);
    expect(invoice.taxableAmount).toBe(700);
    expect(invoice.taxAmount).toBe(24);
    expect(invoice.totalAmount).toBe(724);
    expect(invoice.status).toBe('Unpaid');
    expect(invoice.paidAmount).toBe(0);
    expect(invoice.invoiceNumber).toBeGreaterThan(0);
    expect(invoice.financialYear).toMatch(/^\d{4}-\d{2}$/);

    const taxableItem = invoice.items.find((item) => item.taxPercent === 12)!;
    expect(taxableItem.cgstAmount).toBe(12);
    expect(taxableItem.sgstAmount).toBe(12);
    expect(taxableItem.totalAmount).toBe(224);

    const exemptItem = invoice.items.find((item) => item.taxPercent === 0)!;
    expect(exemptItem.cgstAmount).toBe(0);
    expect(exemptItem.sgstAmount).toBe(0);
    expect(exemptItem.totalAmount).toBe(500);
  });

  it('rejects an invoice with an empty items array', async () => {
    const patient = await makePatient(tenantId1, '5550000002');
    await expect(
      inTenant(tenantId1, () => invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an invoice for an unknown patient', async () => {
    await expect(
      inTenant(tenantId1, () =>
        invoicesService.create({
          patientId: '00000000-0000-0000-0000-000000000000',
          createdBy: STAFF_ID,
          items: [{ description: 'Consultation Fee', unitPrice: 500 }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects providing both sourceAppointmentId and sourceAdmissionId', async () => {
    const patient = await makePatient(tenantId1, '5550000003');
    await expect(
      inTenant(tenantId1, () =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: STAFF_ID,
          sourceAppointmentId: '00000000-0000-0000-0000-0000000000a1',
          sourceAdmissionId: '00000000-0000-0000-0000-0000000000a2',
          items: [{ description: 'Consultation Fee', unitPrice: 500 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('generates sequential invoice numbers within the same financial year', async () => {
    const patient = await makePatient(tenantId1, '5550000004');
    const first = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const second = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item B', unitPrice: 100 }] }),
    );
    expect(second.invoiceNumber).toBe(first.invoiceNumber + 1);
    expect(second.financialYear).toBe(first.financialYear);
  });

  it('fetches an invoice with its items via findOne', async () => {
    const patient = await makePatient(tenantId1, '5550000005');
    const created = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const fetched = await inTenant(tenantId1, () => invoicesService.findOne(created.id));
    expect(fetched.id).toBe(created.id);
    expect(fetched.items).toHaveLength(1);
    expect(fetched.payments).toEqual([]);
  });

  it('throws NotFoundException for an unknown invoice id', async () => {
    await expect(
      inTenant(tenantId1, () => invoicesService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists invoices filtered by patientId, paginated', async () => {
    const patientA = await makePatient(tenantId2, '5550000006');
    const patientB = await makePatient(tenantId2, '5550000007');
    await inTenant(tenantId2, () =>
      invoicesService.create({ patientId: patientA.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await inTenant(tenantId2, () =>
      invoicesService.create({ patientId: patientB.id, createdBy: STAFF_ID, items: [{ description: 'Item B', unitPrice: 100 }] }),
    );

    const filtered = await inTenant(tenantId2, () => invoicesService.list(patientA.id));
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
    expect(filtered.page).toBe(1);
    expect(filtered.limit).toBe(20);
  });

  it('caps limit at 100', async () => {
    const patient = await makePatient(tenantId1, '5550000008');
    await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const result = await inTenant(tenantId1, () => invoicesService.list(patient.id, 1, 500));
    expect(result.limit).toBe(100);
  });

  it('cancels an Unpaid invoice', async () => {
    const patient = await makePatient(tenantId1, '5550000009');
    const created = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const cancelled = await inTenant(tenantId1, () => invoicesService.cancel(created.id));
    expect(cancelled.status).toBe('Cancelled');
  });

  it('rejects cancelling an already-cancelled invoice', async () => {
    const patient = await makePatient(tenantId1, '5550000010');
    const created = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await inTenant(tenantId1, () => invoicesService.cancel(created.id));
    await expect(inTenant(tenantId1, () => invoicesService.cancel(created.id))).rejects.toThrow(ConflictException);
  });

  it('enforces tenant isolation for invoices', async () => {
    const patient = await makePatient(tenantId1, '5550000011');
    const created = await inTenant(tenantId1, () =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await expect(inTenant(tenantId2, () => invoicesService.findOne(created.id))).rejects.toThrow(NotFoundException);
  });
});
