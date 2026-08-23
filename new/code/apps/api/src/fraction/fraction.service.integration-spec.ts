import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FractionService } from './fraction.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { InvoicesService } from '../billing/invoices.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
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

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'fraction', seedRbac: true });
    fractionService = new FractionService(ctx.tenantConnection, ctx.tenantContext);
    patientsService = new PatientsService(ctx.tenantConnection, new PatientNumberGeneratorService(ctx.tenantConnection), new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    invoicesService = new InvoicesService(ctx.tenantConnection, ctx.tenantContext);
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

  async function makeInvoice(patientId: string) {
    return ctx.inTenant(() =>
      invoicesService.create({
        patientId,
        createdBy: STAFF_ID,
        items: [{ description: 'Consultation', unitPrice: 1500 }],
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
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );

    const entry = await withActor(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        baseAmount: 10000,
        recordedBy: STAFF_ID,
      }),
    );
    expect(entry.fractionPercent).toBe(15);
    expect(entry.baseAmount).toBe(10000);
    expect(entry.shareAmount).toBe(1500); // 10000 * 15% = 1500 exactly
    // Actor derivation (section 25): the authenticated principal wins over any caller value.
    expect(entry.recordedBy).toBe(AUTHENTICATED_ACCOUNT);
  });

  it('rounds share amounts to 2 decimals', async () => {
    const doctor = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);
    await ctx.inTenant(() =>
      fractionService.createRule({ doctorId: doctor.id, fractionPercent: 15 }),
    );

    const entry = await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctor.id,
        baseAmount: 3333.33,
        recordedBy: STAFF_ID,
      }),
    );
    // 3333.33 * 15% = 499.9995 -> rounds to 500.00
    expect(entry.shareAmount).toBe(500);
  });

  it('resolves an explicit ruleId and rejects unknown, inactive, or mismatched rules', async () => {
    const doctorA = await makeDoctor();
    const doctorB = await makeDoctor();
    const patient = await makePatient();
    const invoice = await makeInvoice(patient.id);

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
        baseAmount: 2000,
        recordedBy: STAFF_ID,
      }),
    );
    expect(entry.fractionPercent).toBe(25);
    expect(entry.shareAmount).toBe(500);

    // Unknown rule id.
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoice.id,
          doctorId: doctorA.id,
          ruleId: '00000000-0000-0000-0000-000000000000',
          baseAmount: 1000,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    // Rule that belongs to another doctor.
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoice.id,
          doctorId: doctorA.id,
          ruleId: ruleB.id,
          baseAmount: 1000,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);

    // Deactivated rule is rejected even when it matches the doctor.
    await ctx.inTenant(() => fractionService.deactivateRule(ruleA.id));
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoice.id,
          doctorId: doctorA.id,
          ruleId: ruleA.id,
          baseAmount: 1000,
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
          baseAmount: 1000,
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
          baseAmount: 1000,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(NotFoundException);
    // Invalid base amount.
    await expect(
      ctx.inTenant(() =>
        fractionService.recordEntry({
          invoiceId: invoice.id,
          doctorId: doctor.id,
          baseAmount: 0,
          recordedBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
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
        baseAmount: 10000,
        recordedBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() =>
      fractionService.recordEntry({
        invoiceId: invoice.id,
        doctorId: doctorB.id,
        baseAmount: 5000,
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
    expect(fetched.shareAmount).toBe(1500);
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
        baseAmount: 1000,
        recordedBy: '00000000-0000-0000-0000-0000000000ff',
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
        baseAmount: 10000,
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
