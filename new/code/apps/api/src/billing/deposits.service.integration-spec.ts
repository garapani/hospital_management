import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DepositsService } from './deposits.service.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('DepositsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantB: TenantTestContext;
  let patientsService: PatientsService;
  let depositsService: DepositsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'deposits_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext));
    depositsService = new DepositsService(ctx.tenantConnection, ctx.tenantContext);
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

  it('creates a deposit with balance equal to the amount received', async () => {
    const patient = await makePatient(ctx, '6660000001');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
    );
    expect(deposit.amount).toBe(5000);
    expect(deposit.balance).toBe(5000);
    expect(deposit.patientId).toBe(patient.id);
  });

  it('rejects a deposit amount of zero or less', async () => {
    const patient = await makePatient(ctx, '6660000002');
    await expect(
      ctx.inTenant(() => depositsService.create({ patientId: patient.id, amount: 0, receivedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a deposit for an unknown patient', async () => {
    await expect(
      ctx.inTenant(() =>
        depositsService.create({ patientId: '00000000-0000-0000-0000-000000000000', amount: 1000, receivedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('lists deposits filtered by patientId, paginated', async () => {
    const patientA = await makePatient(tenantB, '6660000003');
    const patientB = await makePatient(tenantB, '6660000004');
    await tenantB.inTenant(() => depositsService.create({ patientId: patientA.id, amount: 1000, receivedBy: STAFF_ID }));
    await tenantB.inTenant(() => depositsService.create({ patientId: patientB.id, amount: 2000, receivedBy: STAFF_ID }));

    const filtered = await tenantB.inTenant(() => depositsService.list({ patientId: patientA.id }));
    expect(filtered.meta.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].patientId).toBe(patientA.id);
  });

  it('partially refunds a deposit, decrementing its balance', async () => {
    const patient = await makePatient(ctx, '6660000005');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
    );
    const refunded = await ctx.inTenant(() =>
      depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID }),
    );
    expect(refunded.balance).toBe(3000);
  });

  it('fully refunds a deposit down to a zero balance', async () => {
    const patient = await makePatient(ctx, '6660000006');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 1500, receivedBy: STAFF_ID }),
    );
    const refunded = await ctx.inTenant(() =>
      depositsService.refund(deposit.id, { amount: 1500, refundedBy: STAFF_ID }),
    );
    expect(refunded.balance).toBe(0);
  });

  it('records the refunding actor and timestamp on refund', async () => {
    const patient = await makePatient(ctx, '6660000010');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    const before = Date.now();
    const refunded = await ctx.inTenant(() =>
      depositsService.refund(deposit.id, { amount: 500, refundedBy: STAFF_ID }),
    );
    expect(refunded.refundedBy).toBe(STAFF_ID);
    expect(refunded.refundedAt).not.toBeNull();
    expect(new Date(refunded.refundedAt as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('rejects refunding more than the current balance', async () => {
    const patient = await makePatient(ctx, '6660000007');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 1500, refundedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects refunding a zero or negative amount', async () => {
    const patient = await makePatient(ctx, '6660000008');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 0, refundedBy: STAFF_ID })),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException refunding an unknown deposit id', async () => {
    await expect(
      ctx.inTenant(() =>
        depositsService.refund('00000000-0000-0000-0000-000000000000', { amount: 100, refundedBy: STAFF_ID }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces tenant isolation for deposits', async () => {
    const patient = await makePatient(ctx, '6660000009');
    const deposit = await ctx.inTenant(() =>
      depositsService.create({ patientId: patient.id, amount: 1000, receivedBy: STAFF_ID }),
    );
    await expect(
      tenantB.inTenant(() => depositsService.refund(deposit.id, { amount: 100, refundedBy: STAFF_ID })),
    ).rejects.toThrow(NotFoundException);
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

    // Unique phone numbers per patient — the patients duplicate check throws ConflictException
    // on reuse.
    let patientSeq = 10;
    async function makePatientWithDeposit(amount: number) {
      patientSeq += 1;
      const patient = await makePatient(ctx, `66600000${patientSeq}`);
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount, receivedBy: STAFF_ID }),
      );
      return { patient, deposit };
    }

    it('create records the authenticated account as receivedBy, never the spoofed value', async () => {
      const { patient } = await makePatientWithDeposit(1000);
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const created = await withActor(() =>
        depositsService.create({ patientId: patient.id, amount: 500, receivedBy: spoofed }),
      );
      expect(created.receivedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('refund records the authenticated account as refundedBy, never the spoofed value', async () => {
      const { deposit } = await makePatientWithDeposit(1000);
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const refunded = await withActor(() =>
        depositsService.refund(deposit.id, { amount: 100, refundedBy: spoofed }),
      );
      expect(refunded.refundedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
