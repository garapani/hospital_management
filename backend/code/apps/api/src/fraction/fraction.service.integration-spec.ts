import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FractionService } from './fraction.service.js';
import { FractionEntry } from './entities/fraction.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { PdfService } from '@hospital/pdf';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('FractionService (integration)', () => {
  let ctx: TenantTestContext;
  let fractionService: FractionService;
  let patientsService: PatientsService;
  let invoicesService: InvoicesService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'fraction', seedRbac: true });
    fractionService = new FractionService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext), new PdfService());
    invoicesService = new InvoicesService(
      ctx.tenantConnection,
      ctx.tenantContext,
      new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext),
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'fraction-test' },
      work,
    );
  }

  let seq = 0;

  async function makeDoctor() {
    seq += 1;
    return ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: `fraction.dr${seq}`,
        email: `fraction.dr${seq}@example.com`,
        displayName: `Fraction Dr ${seq}`,
        password: 'correct-horse-battery-staple',
        roleName: 'Doctor',
      }),
    );
  }

  async function makePatient() {
    seq += 1;
    return ctx.inTenant(() =>
      patientsService.create({
        firstName: 'Fraction',
        lastName: `Patient${seq}`,
        dateOfBirth: '1985-05-05',
        gender: 'Female',
        phoneNumber: `5580000${String(seq).padStart(3, '0')}`,
      }),
    );
  }

  async function makeInvoice(patientId: string, unitPrice = 1500) {
    return ctx.inTenant(() =>
      invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation', unitPrice }],
      }),
    );
  }

  it('creates fraction rules and validates percent bounds and the doctor reference', async () => {
    const doctor = await makeDoctor();
    const rule = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );
    expect(rule.fractionPercent).toBe(15);
    expect(rule.doctorId).toBe(doctor.id);
    expect(rule.isActive).toBe(true);

    await expect(
      ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 0 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 101 })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        fractionService.createRule({
          doctorId: '00000000-0000-0000-0000-000000000000',
          fractionPercent: 10,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes and reactivates rules; double-deactivation conflicts', async () => {
    const doctor = await makeDoctor();
    const rule = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 20 }),
    );
    await ctx.inTenant(() => fractionService.deactivateRule(rule.id));
    await expect(ctx.inTenant(() => fractionService.deactivateRule(rule.id))).rejects.toThrow(
      ConflictException,
    );
    const reactivated = await ctx.inTenant(() => fractionService.reactivateRule(rule.id));
    expect(reactivated.isActive).toBe(true);
    await expect(
      ctx.inTenant(() => fractionService.deactivateRule('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('records an entry with exact share math via the default null-department rule', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id, 10000);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );

    const entry = await withActor(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        recordedBy: STAFF_ID,
      }),
    );
    expect(entry.fractionPercent).toBe(15);
    // baseAmount is the invoice's own totalAmount, resolved server-side — never client input.
    expect(entry.baseAmount).toBe(10000);
    expect(entry.shareAmount).toBe(1500); // 10000 * 15% = 1500 exactly
    // Actor derivation (section 25): the authenticated principal wins over any caller value.
    expect(entry.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('rounds share amounts to 2 decimals', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id, 3333.33);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );

    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        recordedBy: STAFF_ID,
      }),
    );
    // 3333.33 * 15% = 499.9995 -> rounds to 500.00
    expect(entry.shareAmount).toBe(500);
  });

  it('ignores a caller-supplied baseAmount and always uses the invoice totalAmount', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id, 500);
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }));

    // A caller (or a stale client) attempting the old, now-removed field — must be ignored.
    const maliciousInput = {
      invoiceId: invoice.id,
      doctorId: doctor.id,
      recordedBy: STAFF_ID,
      baseAmount: 1000000,
    } as unknown as Parameters<typeof fractionService.recordEntry>[0];

    const entry = await ctx.inTenant(() => fractionService.recordEntry(maliciousInput));
    expect(entry.baseAmount).toBe(500);
    expect(entry.shareAmount).toBe(50); // 500 * 10%, not 1000000 * 10%
  });

  it('resolves an explicit ruleId and rejects unknown, inactive, or mismatched rules', async () => {
    const doctorA = await makeDoctor();
    const doctorB = await makeDoctor();
    const patient = await makePatient();
    // Each negative sub-case below uses its own fresh invoice: doctorA is only allowed one
    // entry per invoice (idempotency fix below), so reusing one invoice across sub-cases
    // would make the second call fail on that instead of the rule-validation being tested.
    const invoice = await makeInvoice(patient.id, 2000);

    const ruleA = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctorA.id, fractionPercent: 25 }),
    );
    const ruleB = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctorB.id, fractionPercent: 30 }),
    );

    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctorA.id,
        ruleId: ruleA.id,
        recordedBy: STAFF_ID,
      }),
    );
    expect(entry.fractionPercent).toBe(25);
    expect(entry.shareAmount).toBe(500);

    // Unknown rule id.
    const invoiceForUnknownRule = await makeInvoice(patient.id);
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoiceForUnknownRule.id,
          doctorId: doctorA.id,
          ruleId: '00000000-0000-0000-0000-000000000000',
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    // Rule that belongs to another doctor.
    const invoiceForMismatchedRule = await makeInvoice(patient.id);
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoiceForMismatchedRule.id,
          doctorId: doctorA.id,
          ruleId: ruleB.id,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Deactivated rule is rejected even when it matches the doctor.
    await ctx.inTenant(() => fractionService.deactivateRule(ruleA.id));
    const invoiceForDeactivatedRule = await makeInvoice(patient.id);
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoiceForDeactivatedRule.id,
          doctorId: doctorA.id,
          ruleId: ruleA.id,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects entries with no active default rule and against unknown invoices', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);

    // No rule at all for this doctor.
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoice.id,
          doctorId: doctor.id,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/No active fraction rule/);

    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }),
    );

    // Unknown invoice.
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: '00000000-0000-0000-0000-000000000000',
          doctorId: doctor.id,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a second entry for the same invoice and doctor (idempotency)', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }));

    await ctx.inTenant(() =>
      fractionService.recordEntry({ invoiceId: invoice.id, doctorId: doctor.id, recordedBy: STAFF_ID }),
    );

    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({ invoiceId: invoice.id, doctorId: doctor.id, recordedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(ConflictException);

    // Different doctor, same invoice — not a duplicate, must still succeed.
    const otherDoctor = await makeDoctor();
    await ctx.inTenant(() => fractionService.createRule({ doctorId: otherDoctor.id, fractionPercent: 5 }));
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({ invoiceId: invoice.id, doctorId: otherDoctor.id, recordedBy: STAFF_ID }),
      ),
    ).resolves.toBeDefined();
  });

  it('UQ_fraction_entries_invoice_doctor rejects a second concurrent entry for the same invoice/doctor', async () => {
    // The service-level pre-check above closes the sequential case; this proves the DB
    // constraint itself — the backstop for two truly concurrent recordEntry calls — actually
    // exists and rejects the second insert, the same way UQ_admissions_active_bed/
    // UQ_admissions_active_patient are proven elsewhere in this codebase.
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);

    const results = await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) => {
        const repository = manager.getRepository(FractionEntry);
        const insertOne = () =>
          repository.save(
            repository.create({
              invoiceId: invoice.id,
              doctorId: doctor.id,
              fractionPercent: 10,
              baseAmount: 1000,
              shareAmount: 100,
              recordedBy: STAFF_ID,
            }),
          );
        return Promise.allSettled([insertOne(), insertOne()]);
      }),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('rejects a second active default rule for the same doctor, while allowing department rules', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }),
    );

    // A second active default (null-department) rule is ambiguous by definition — rejected.
    await expect(
      ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 20 })),
    ).rejects.toThrow(ConflictException);

    // Department-specific rules coexist with the default.
    const departmentRule = await ctx.inTenant(() =>
      fractionService.createRule({
        doctorId: doctor.id,
        departmentId: '00000000-0000-4000-8000-0000000000d1',
        fractionPercent: 25,
      }),
    );
    expect(departmentRule.fractionPercent).toBe(25);

    // Deactivating the default frees the slot for a new one.
    const defaultRules = await ctx.inTenant(() =>
      fractionService.listRules({ doctorId: doctor.id }),
    );
    const defaultRule = defaultRules.data.find((r) => r.departmentId === null)!;
    await ctx.inTenant(() => fractionService.deactivateRule(defaultRule.id));
    const replacement = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 30 }),
    );
    expect(replacement.fractionPercent).toBe(30);

    // Sanity: the entry path still resolves a share.
    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        recordedBy: STAFF_ID,
      }),
    );
    expect(entry.fractionPercent).toBe(30);
  });

  it('reverses a share entry and rejects double reversal', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }));
    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({ invoiceId: invoice.id, doctorId: doctor.id, recordedBy: STAFF_ID }),
    );

    const reversed = await ctx.inTenant(() => fractionService.reverseEntry(entry.id, STAFF_ID));
    expect(reversed.reversedAt).not.toBeNull();
    expect(reversed.reversedBy).toBe(STAFF_ID);

    await expect(
      ctx.inTenant(() => fractionService.reverseEntry(entry.id, STAFF_ID)),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => fractionService.reverseEntry('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('reverses every live entry for an invoice via reverseEntriesForInvoice', async () => {
    const doctorA = await makeDoctor();
    const doctorB = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctorA.id, fractionPercent: 10 }));
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctorB.id, fractionPercent: 5 }));
    await ctx.inTenant(() =>
      fractionService.recordEntry({ invoiceId: invoice.id, doctorId: doctorA.id, recordedBy: STAFF_ID }),
    );
    await ctx.inTenant(() =>
      fractionService.recordEntry({ invoiceId: invoice.id, doctorId: doctorB.id, recordedBy: STAFF_ID }),
    );

    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        fractionService.reverseEntriesForInvoice(manager, invoice.id),
      ),
    );

    const entries = await ctx.inTenant(() => fractionService.listEntries({ invoiceId: invoice.id }));
    expect(entries.data).toHaveLength(2);
    expect(entries.data.every((e) => e.reversedAt !== null)).toBe(true);

    // Idempotent: running it again is a no-op.
    await ctx.inTenant(() =>
      ctx.tenantConnection.runInTenantSchema((manager) =>
        fractionService.reverseEntriesForInvoice(manager, invoice.id),
      ),
    );
    const again = await ctx.inTenant(() => fractionService.listEntries({ invoiceId: invoice.id }));
    expect(again.data.every((e) => e.reversedAt !== null)).toBe(true);
  });

  it('lists and fetches entries, filtered by invoice and doctor', async () => {
    const doctorA = await makeDoctor();
    const doctorB = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctorA.id, fractionPercent: 15 }));
    await ctx.inTenant(() => fractionService.createRule({ doctorId: doctorB.id, fractionPercent: 10 }));

    const entryA = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctorA.id,
        recordedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctorB.id,
        recordedBy: STAFF_ID,
      }),
    );

    const byInvoice = await ctx.inTenant(() => fractionService.listEntries({ invoiceId: invoice.id }));
    expect(byInvoice.data).toHaveLength(2);
    expect(byInvoice.meta.total).toBe(2);

    const byDoctor = await ctx.inTenant(() => fractionService.listEntries({ doctorId: doctorA.id }));
    expect(byDoctor.data).toHaveLength(1);
    expect(byDoctor.data[0].id).toBe(entryA.id);

    const fetched = await ctx.inTenant(() => fractionService.getEntry(entryA.id));
    expect(fetched.shareAmount).toBe(225); // invoice totalAmount 1500 * 15%
    await expect(
      ctx.inTenant(() => fractionService.getEntry('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow(NotFoundException);
  });

  it('derives recordedBy from the authenticated principal even when spoofed', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 10 }),
    );

    const entry = await withActor(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        recordedBy: '00000000-0000-4000-8000-0000000000ff',
      }),
    );
    expect(entry.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('enforces tenant isolation', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    const rule = await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );
    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        recordedBy: STAFF_ID,
      }),
    );

    const tenantB = await ctx.createTenant();
    await expect(
      tenantB.inTenant(() => fractionService.listRules({})),
    ).resolves.toEqual(expect.objectContaining({ data: [], meta: expect.objectContaining({ total: 0 }) }));
    await expect(
      tenantB.inTenant(() => fractionService.getEntry(entry.id)),
    ).rejects.toThrow(NotFoundException);
    await expect(
      tenantB.inTenant(() => fractionService.deactivateRule(rule.id)),
    ).rejects.toThrow(NotFoundException);
  });
});
