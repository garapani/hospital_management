import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InvoicesService, getFinancialYearStart } from './invoices.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { DepositsService } from './deposits.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { JournalEntry } from '../accounting/entities/journal-entry.entity.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('InvoicesService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;
  let depositsService: DepositsService;
  let accountingService: AccountingService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'invoices_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    accountingService = new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext);
    invoicesService = new InvoicesService(ctx.tenantConnection, ctx.tenantContext, accountingService);
    depositsService = new DepositsService(ctx.tenantConnection, ctx.tenantContext, accountingService);
  });

  afterAll(() => teardownTenantTestContext(ctx));

  async function makePatient(tenantCtx: TenantTestContext, phoneNumber: string) {
    return tenantCtx.inTenant(() =>
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
    const patient = await makePatient(ctx, '5550000001');
    const invoice = await ctx.inTenant(() =>
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
    const patient = await makePatient(ctx, '5550000002');
    await expect(
      ctx.inTenant(() => invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [] })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an invoice for an unknown patient', async () => {
    await expect(
      ctx.inTenant(() =>
        invoicesService.create({
          patientId: '00000000-0000-0000-0000-000000000000',
          createdBy: STAFF_ID,
          items: [{ description: 'Consultation Fee', unitPrice: 500 }],
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects providing both sourceAppointmentId and sourceAdmissionId', async () => {
    const patient = await makePatient(ctx, '5550000003');
    await expect(
      ctx.inTenant(() =>
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
    const patient = await makePatient(ctx, '5550000004');
    const first = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const second = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item B', unitPrice: 100 }] }),
    );
    expect(second.invoiceNumber).toBe(first.invoiceNumber + 1);
    expect(second.financialYear).toBe(first.financialYear);
  });

  it('auto-settles a fully-waived invoice with zero total as Paid', async () => {
    const patient = await makePatient(ctx, '5550000099');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({
        patientId: patient.id,
        createdBy: STAFF_ID,
        items: [{ description: 'Waived Item', unitPrice: 0 }],
      }),
    );
    expect(invoice.totalAmount).toBe(0);
    expect(invoice.status).toBe('Paid');
  });

  it('rejects cancelling a zero-total invoice that was auto-settled as Paid', async () => {
    const patient = await makePatient(ctx, '5550000097');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({
        patientId: patient.id,
        createdBy: STAFF_ID,
        items: [{ description: 'Waived Item', unitPrice: 0 }],
      }),
    );
    expect(invoice.status).toBe('Paid');
    await expect(ctx.inTenant(() => invoicesService.cancel(invoice.id))).rejects.toThrow(ConflictException);
  });

  it('fetches an invoice with its items via findOne', async () => {
    const patient = await makePatient(ctx, '5550000005');
    const created = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const fetched = await ctx.inTenant(() => invoicesService.findOne(created.id));
    expect(fetched.id).toBe(created.id);
    expect(fetched.items).toHaveLength(1);
    expect(fetched.payments).toEqual([]);
  });

  it('throws NotFoundException for an unknown invoice id', async () => {
    await expect(
      ctx.inTenant(() => invoicesService.findOne('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists invoices filtered by patientId, paginated', async () => {
    const patientA = await makePatient(tenantB, '5550000006');
    const patientB = await makePatient(tenantB, '5550000007');
    await tenantB.inTenant(() =>
      invoicesService.create({ patientId: patientA.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await tenantB.inTenant(() =>
      invoicesService.create({ patientId: patientB.id, createdBy: STAFF_ID, items: [{ description: 'Item B', unitPrice: 100 }] }),
    );

    const filtered = await tenantB.inTenant(() => invoicesService.list({ patientId: patientA.id }));
    expect(filtered.meta.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
    expect(filtered.meta.page).toBe(1);
    expect(filtered.meta.limit).toBe(20);
  });

  it('caps limit at 100', async () => {
    const patient = await makePatient(ctx, '5550000008');
    await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const result = await ctx.inTenant(() => invoicesService.list({ patientId: patient.id, page: 1, limit: 500 }));
    expect(result.meta.limit).toBe(100);
  });

  it('cancels an Unpaid invoice', async () => {
    const patient = await makePatient(ctx, '5550000009');
    const created = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    const cancelled = await ctx.inTenant(() => invoicesService.cancel(created.id));
    expect(cancelled.status).toBe('Cancelled');
  });

  it('rejects cancelling an already-cancelled invoice', async () => {
    const patient = await makePatient(ctx, '5550000010');
    const created = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await ctx.inTenant(() => invoicesService.cancel(created.id));
    await expect(ctx.inTenant(() => invoicesService.cancel(created.id))).rejects.toThrow(ConflictException);
  });

  it('enforces tenant isolation for invoices', async () => {
    const patient = await makePatient(ctx, '5550000011');
    const created = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );
    await expect(tenantB.inTenant(() => invoicesService.findOne(created.id))).rejects.toThrow(NotFoundException);
  });

  it('rejects an item with a negative unitPrice', async () => {
    const patient = await makePatient(ctx, '5550000012');
    await expect(
      ctx.inTenant(() =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: STAFF_ID,
          items: [{ description: 'Bad Item', unitPrice: -10 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an item whose discountAmount exceeds its line subtotal', async () => {
    const patient = await makePatient(ctx, '5550000013');
    await expect(
      ctx.inTenant(() =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: STAFF_ID,
          items: [{ description: 'Overdiscounted Item', unitPrice: 500, discountAmount: 1000 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not consume an invoice sequence number when item validation rejects the invoice', async () => {
    const patient = await makePatient(ctx, '5550000014');
    const first = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 100 }] }),
    );

    await expect(
      ctx.inTenant(() =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: STAFF_ID,
          items: [{ description: 'Bad Item', unitPrice: -10 }],
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    const second = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item B', unitPrice: 100 }] }),
    );

    expect(second.invoiceNumber).toBe(first.invoiceNumber + 1);
  });

  it('records a partial payment, moving status to PartiallyPaid', async () => {
    const patient = await makePatient(ctx, '5550000023');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    const payment = await ctx.inTenant(() =>
      invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID }),
    );
    expect(payment.amount).toBe(400);
    expect(payment.paymentMode).toBe('Cash');

    const refetched = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(refetched.paidAmount).toBe(400);
    expect(refetched.status).toBe('PartiallyPaid');
    expect(refetched.payments).toHaveLength(1);
  });

  it('records a payment that completes the balance, moving status to Paid', async () => {
    const patient = await makePatient(ctx, '5550000024');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID }));
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 600, paymentMode: 'Card', receivedBy: STAFF_ID }));

    const refetched = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(refetched.paidAmount).toBe(1000);
    expect(refetched.status).toBe('Paid');
    expect(refetched.payments).toHaveLength(2);
  });

  it('rejects a payment exceeding the outstanding balance', async () => {
    const patient = await makePatient(ctx, '5550000025');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 1500, paymentMode: 'Cash', receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a payment amount of zero or less', async () => {
    const patient = await makePatient(ctx, '5550000026');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 0, paymentMode: 'Cash', receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects an unsupported paymentMode', async () => {
    const patient = await makePatient(ctx, '5550000098');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 100, paymentMode: 'deposit', receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 100, paymentMode: 'Bogus', receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects cancelling an invoice that already has a payment', async () => {
    const patient = await makePatient(ctx, '5550000027');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID }));
    await expect(ctx.inTenant(() => invoicesService.cancel(invoice.id))).rejects.toThrow(ConflictException);
  });

  it('rejects recording a payment against a cancelled invoice', async () => {
    const patient = await makePatient(ctx, '5550000034');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.cancel(invoice.id));
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID })),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException recording a payment against an unknown invoice', async () => {
    await expect(
      ctx.inTenant(() =>
        invoicesService.recordPayment('00000000-0000-0000-0000-000000000000', { amount: 100, paymentMode: 'Cash', receivedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects paymentMode Deposit without a sourceDepositId', async () => {
    const patient = await makePatient(ctx, '5550000028');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Deposit', receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('applies a deposit as a payment, decrementing the deposit balance', async () => {
    const patient = await makePatient(ctx, '5550000029');
    const deposit = await ctx.inTenant(() => depositsService.create({ patientId: patient.id, amount: 2000, receivedBy: STAFF_ID }));
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() =>
      invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Deposit', sourceDepositId: deposit.id, receivedBy: STAFF_ID }),
    );

    const refetchedInvoice = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(refetchedInvoice.status).toBe('Paid');
    const refetchedDeposits = await ctx.inTenant(() => depositsService.list({ patientId: patient.id }));
    expect(refetchedDeposits.data[0].balance).toBe(1000);
  });

  it('rejects applying a deposit with insufficient balance', async () => {
    const patient = await makePatient(ctx, '5550000030');
    const deposit = await ctx.inTenant(() => depositsService.create({ patientId: patient.id, amount: 100, receivedBy: STAFF_ID }));
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, { amount: 500, paymentMode: 'Deposit', sourceDepositId: deposit.id, receivedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects applying a deposit that belongs to a different patient', async () => {
    const patientA = await makePatient(ctx, '5550000031');
    const patientB = await makePatient(ctx, '5550000032');
    const deposit = await ctx.inTenant(() => depositsService.create({ patientId: patientA.id, amount: 2000, receivedBy: STAFF_ID }));
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patientB.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, { amount: 500, paymentMode: 'Deposit', sourceDepositId: deposit.id, receivedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException applying an unknown deposit id', async () => {
    const patient = await makePatient(ctx, '5550000033');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, {
          amount: 500,
          paymentMode: 'Deposit',
          sourceDepositId: '00000000-0000-0000-0000-000000000000',
          receivedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('issues a full return on a fully-paid invoice, zeroing totalAmount/paidAmount and status Paid', async () => {
    const patient = await makePatient(ctx, '5550000035');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }));

    const returnRecord = await ctx.inTenant(() =>
      invoicesService.createReturn(invoice.id, { amount: 1000, reason: 'Medicine returned to pharmacy', returnedBy: STAFF_ID }),
    );
    expect(returnRecord.amount).toBe(1000);
    expect(returnRecord.reason).toBe('Medicine returned to pharmacy');

    const refetched = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(refetched.totalAmount).toBe(0);
    expect(refetched.paidAmount).toBe(0);
    expect(refetched.status).toBe('Paid');
    expect(refetched.returns).toHaveLength(1);
  });

  it('issues a partial return on a partially-paid invoice, reducing totalAmount/paidAmount and keeping status PartiallyPaid', async () => {
    const patient = await makePatient(ctx, '5550000036');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID }));

    await ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: 150, reason: 'Test cancelled', returnedBy: STAFF_ID }));

    const refetched = await ctx.inTenant(() => invoicesService.findOne(invoice.id));
    expect(refetched.totalAmount).toBe(850);
    expect(refetched.paidAmount).toBe(250);
    expect(refetched.status).toBe('PartiallyPaid');
  });

  it('rejects a return amount of zero or less', async () => {
    const patient = await makePatient(ctx, '5550000037');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }));
    await expect(
      ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: 0, reason: 'x', returnedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a non-numeric return amount instead of silently passing validation', async () => {
    const patient = await makePatient(ctx, '5550000041');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }));
    await expect(
      ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: Number('not-a-number'), reason: 'x', returnedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        invoicesService.createReturn(invoice.id, { amount: undefined as unknown as number, reason: 'x', returnedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a return exceeding the invoice paidAmount', async () => {
    const patient = await makePatient(ctx, '5550000038');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: STAFF_ID }));
    await expect(
      ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: 500, reason: 'x', returnedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a return on an Unpaid invoice with no payments recorded', async () => {
    const patient = await makePatient(ctx, '5550000039');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await expect(
      ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: 100, reason: 'x', returnedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a return on a Cancelled invoice', async () => {
    const patient = await makePatient(ctx, '5550000040');
    const invoice = await ctx.inTenant(() =>
      invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
    );
    await ctx.inTenant(() => invoicesService.cancel(invoice.id));
    await expect(
      ctx.inTenant(() => invoicesService.createReturn(invoice.id, { amount: 100, reason: 'x', returnedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException issuing a return against an unknown invoice', async () => {
    await expect(
      ctx.inTenant(() =>
        invoicesService.createReturn('00000000-0000-0000-0000-000000000000', { amount: 100, reason: 'x', returnedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  describe('automatic ledger posting on billing events', () => {
    async function postPaymentJournalDirectly(paymentId: string, amount: number, debitAccountId: string) {
      return ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          accountingService.postAutoJournal(manager, {
            sourceType: 'Payment',
            sourceId: paymentId,
            entryDate: new Date().toISOString().slice(0, 10),
            actor: STAFF_ID,
            lines: [
              { accountId: debitAccountId, debit: amount },
              { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: amount },
            ],
          }),
        ),
      );
    }

    async function countJournalsForSource(sourceType: string, sourceId: string) {
      return ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          manager.getRepository(JournalEntry).count({ where: { sourceType, sourceId } }),
        ),
      );
    }

    it('posts a balanced Cash/Bank vs Patient AR journal when a Cash payment is recorded, and a retried post is a no-op', async () => {
      const patient = await makePatient(ctx, '5550000060');
      const invoice = await ctx.inTenant(() =>
        invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
      );
      const payment = await ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }),
      );

      const journal = await postPaymentJournalDirectly(payment.id, 1000, LEDGER_ACCOUNT_IDS.CASH_AND_BANK);
      expect(journal.status).toBe('Posted');
      expect(journal.sourceType).toBe('Payment');
      expect(journal.sourceId).toBe(payment.id);
      expect(journal.lines).toHaveLength(2);
      const totalDebit = journal.lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = journal.lines.reduce((sum, line) => sum + line.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.CASH_AND_BANK)?.debit).toBe(1000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE)?.credit).toBe(1000);

      // Idempotency: simulates a retried/replayed payment event by posting for the same source a
      // second time — must return the SAME journal, not create a duplicate.
      expect(await countJournalsForSource('Payment', payment.id)).toBe(1);
      const retried = await postPaymentJournalDirectly(payment.id, 1000, LEDGER_ACCOUNT_IDS.CASH_AND_BANK);
      expect(retried.id).toBe(journal.id);
      expect(retried.journalNumber).toBe(journal.journalNumber);
      expect(await countJournalsForSource('Payment', payment.id)).toBe(1);
    });

    it('posts a Patient Deposits Payable settlement journal for a Deposit-sourced payment', async () => {
      const patient = await makePatient(ctx, '5550000061');
      const deposit = await ctx.inTenant(() => depositsService.create({ patientId: patient.id, amount: 2000, receivedBy: STAFF_ID }));
      const invoice = await ctx.inTenant(() =>
        invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
      );
      const payment = await ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, {
          amount: 1000,
          paymentMode: 'Deposit',
          sourceDepositId: deposit.id,
          receivedBy: STAFF_ID,
        }),
      );

      const journal = await postPaymentJournalDirectly(payment.id, 1000, LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE)?.debit).toBe(1000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE)?.credit).toBe(1000);
    });

    it('posts a Sales Returns contra-revenue journal on createReturn', async () => {
      const patient = await makePatient(ctx, '5550000062');
      const invoice = await ctx.inTenant(() =>
        invoicesService.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
      );
      await ctx.inTenant(() => invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }));
      const returnRecord = await ctx.inTenant(() =>
        invoicesService.createReturn(invoice.id, { amount: 300, reason: 'Overcharged', returnedBy: STAFF_ID }),
      );

      const journal = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          accountingService.postAutoJournal(manager, {
            sourceType: 'Return',
            sourceId: returnRecord.id,
            entryDate: new Date().toISOString().slice(0, 10),
            actor: STAFF_ID,
            lines: [
              { accountId: LEDGER_ACCOUNT_IDS.SALES_RETURNS, debit: 300 },
              { accountId: LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE, credit: 300 },
            ],
          }),
        ),
      );
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.SALES_RETURNS)?.debit).toBe(300);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE)?.credit).toBe(300);
    });

    it('reflects a posted payment journal in the trial balance, hermetically in its own tenant', async () => {
      // Reports aggregate the whole tenant (see AccountingService's own report tests), so this
      // runs in a dedicated tenant to keep the numbers free of this file's other tests.
      const reportCtx = await ctx.createTenant();
      const reportAccounting = new AccountingService(
        ctx.tenantConnection,
        new JournalNumberGeneratorService(ctx.tenantConnection),
        reportCtx.tenantContext,
      );
      const reportInvoices = new InvoicesService(ctx.tenantConnection, reportCtx.tenantContext, reportAccounting);
      const reportPatients = new PatientsService(
        ctx.tenantConnection,
        new PatientNumberGeneratorService(ctx.tenantConnection),
        new AccountsService(ctx.tenantConnection, ctx.dataSource, reportCtx.tenantContext),
      );
      const inReport = <T>(work: () => Promise<T>): Promise<T> =>
        reportCtx.tenantContext.run({ tenantId: reportCtx.tenantId, correlationId: 'report' }, work);

      const patient = await inReport(() =>
        reportPatients.create({
          firstName: 'Report',
          lastName: 'Patient',
          dateOfBirth: '1990-01-01',
          gender: 'Male',
          phoneNumber: '7770000001',
        }),
      );
      const invoice = await inReport(() =>
        reportInvoices.create({ patientId: patient.id, createdBy: STAFF_ID, items: [{ description: 'Item A', unitPrice: 1000 }] }),
      );
      await inReport(() => reportInvoices.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }));

      const trial = await inReport(() => reportAccounting.trialBalance());
      const byCode = new Map(trial.map((row) => [row.accountCode, row]));
      // Manually-created invoice (not charge-captured), so Patient AR was never debited — only
      // the payment posted. Cash/Bank (1010) carries the debit; Patient AR (1000) carries the
      // offsetting credit. Manual-invoice revenue recognition is out of scope for this iteration
      // (see Development-Standards.md).
      expect(byCode.get('1010')?.balance).toBe(1000);
      expect(byCode.get('1000')?.balance).toBe(-1000);
    });
  });

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

    function withActor<T>(work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'actor-test' },
        work,
      );
    }

    const SPOOFED_ACTOR = '00000000-0000-0000-0000-0000000000ff';
    let actorSeq = 0;
    async function makeInvoice() {
      actorSeq += 1;
      // Unique per-test phone number (patients duplicate check throws on reuse); 51 is
      // reserved by the create test above.
      const patient = await makePatient(ctx, `5550000${51 + actorSeq}`);
      return ctx.inTenant(() =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: STAFF_ID,
          items: [{ description: 'Item A', unitPrice: 1000 }],
        }),
      );
    }

    it('create records the authenticated account as createdBy, not the body value', async () => {
      const patient = await makePatient(ctx, '5550000051');
      const invoice = await withActor(() =>
        invoicesService.create({
          patientId: patient.id,
          createdBy: SPOOFED_ACTOR,
          items: [{ description: 'Consultation Fee', unitPrice: 500 }],
        }),
      );
      expect(invoice.createdBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('recordPayment records the authenticated account as receivedBy, not the body value', async () => {
      const invoice = await makeInvoice();
      const payment = await withActor(() =>
        invoicesService.recordPayment(invoice.id, { amount: 400, paymentMode: 'Cash', receivedBy: SPOOFED_ACTOR }),
      );
      expect(payment.receivedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('createReturn records the authenticated account as returnedBy, not the body value', async () => {
      const invoice = await makeInvoice();
      await ctx.inTenant(() =>
        invoicesService.recordPayment(invoice.id, { amount: 1000, paymentMode: 'Cash', receivedBy: STAFF_ID }),
      );
      const returnRecord = await withActor(() =>
        invoicesService.createReturn(invoice.id, { amount: 500, reason: 'Medicine returned to pharmacy', returnedBy: SPOOFED_ACTOR }),
      );
      expect(returnRecord.returnedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});

describe('getFinancialYearStart (IST pinning)', () => {
  // 2026-03-31T19:00:00Z is 2026-04-01T00:30:00 in Asia/Kolkata (UTC+5:30) —
  // the UTC calendar date is still March 31st, but the IST calendar date is
  // already April 1st, which must fall in FY 2026 (not FY 2025). This proves
  // the calculation is anchored to Asia/Kolkata regardless of the process's
  // local/UTC timezone.
  it('uses the IST calendar date, not the UTC/server-local date, at the FY boundary', () => {
    const lateMarchUtc = new Date('2026-03-31T19:00:00Z');
    expect(getFinancialYearStart(lateMarchUtc)).toBe(2026);

    const justBeforeIstBoundary = new Date('2026-03-31T18:29:00Z'); // 2026-03-31T23:59 IST
    expect(getFinancialYearStart(justBeforeIstBoundary)).toBe(2025);
  });
});
