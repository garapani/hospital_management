import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DepositsService } from './deposits.service.js';
import { Deposit } from './entities/deposit.entity.js';
import { PatientsService } from '../patients/patients.service.js';
import { PatientNumberGeneratorService } from '../patients/patient-number-generator.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { JournalNumberGeneratorService } from '../accounting/journal-number-generator.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import { PdfService } from '@hospital/pdf';
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
  let accountingService: AccountingService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'deposits_svc' });
    tenantB = await ctx.createTenant();

    const patientSequence = new PatientNumberGeneratorService(ctx.tenantConnection);
    patientsService = new PatientsService(ctx.tenantConnection, patientSequence, new AccountsService(ctx.tenantConnection, ctx.dataSource, ctx.tenantContext), new PdfService());
    accountingService = new AccountingService(ctx.tenantConnection, new JournalNumberGeneratorService(ctx.tenantConnection), ctx.tenantContext);
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

  const STAFF_ID = '00000000-0000-4000-8000-0000000000f1';

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

  describe('automatic ledger posting on billing events', () => {
    async function postDepositJournalDirectly(depositId: string, amount: number) {
      return ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          accountingService.postAutoJournal(manager, {
            sourceType: 'Deposit',
            sourceId: depositId,
            entryDate: new Date().toISOString().slice(0, 10),
            actor: STAFF_ID,
            lines: [
              { accountId: LEDGER_ACCOUNT_IDS.CASH_AND_BANK, debit: amount },
              { accountId: LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE, credit: amount },
            ],
          }),
        ),
      );
    }

    async function postRefundJournalDirectly(depositId: string, amount: number) {
      return ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) =>
          accountingService.postAutoJournal(manager, {
            sourceType: 'DepositRefund',
            sourceId: depositId,
            entryDate: new Date().toISOString().slice(0, 10),
            actor: STAFF_ID,
            lines: [
              { accountId: LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE, debit: amount },
              { accountId: LEDGER_ACCOUNT_IDS.CASH_AND_BANK, credit: amount },
            ],
          }),
        ),
      );
    }

    it('posts a Cash/Bank vs Patient Deposits Payable journal when a deposit is received', async () => {
      const patient = await makePatient(ctx, '6660000020');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );

      const journal = await postDepositJournalDirectly(deposit.id, 5000);
      expect(journal.status).toBe('Posted');
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.CASH_AND_BANK)?.debit).toBe(5000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE)?.credit).toBe(5000);
    });

    it('posts a Patient Deposits Payable vs Cash/Bank journal on refund', async () => {
      const patient = await makePatient(ctx, '6660000021');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );
      await ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID }));

      const journal = await postRefundJournalDirectly(deposit.id, 2000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE)?.debit).toBe(2000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.CASH_AND_BANK)?.credit).toBe(2000);
    });

    it('fails loud posting a journal directly for a different amount than an existing refund journal', async () => {
      const patient = await makePatient(ctx, '6660000022');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );
      await ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 1000, refundedBy: STAFF_ID }));

      // AccountingService.postAutoJournal's own (sourceType, sourceId) dedup: a directly-posted
      // journal reusing this deposit's source key with different lines than what's already there
      // is a conflict, not a retry — fails loud rather than silently mis-booking it.
      await expect(postRefundJournalDirectly(deposit.id, 1500)).rejects.toThrow(ConflictException);
    });

    // Regression tests for code-review-findings-2026-08-25.md's billing P2: a repeated
    // same-amount refund() call used to decrement balance a second time for real, while the
    // ledger posting silently no-op'd — so the deposit's balance and the general ledger
    // disagreed. refund() itself must now be idempotent, not just its ledger posting.
    it('treats a repeated same-amount refund() call as a safe no-op, not a second decrement', async () => {
      const patient = await makePatient(ctx, '6660000023');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );
      const first = await ctx.inTenant(() =>
        depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID }),
      );
      expect(first.balance).toBe(3000);

      const retried = await ctx.inTenant(() =>
        depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID }),
      );
      expect(retried.balance).toBe(3000);

      const journal = await postRefundJournalDirectly(deposit.id, 2000);
      expect(journal.lines.find((line) => line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE)?.debit).toBe(2000);
    });

    it('rejects a second refund() call for a different amount against the same deposit before mutating balance', async () => {
      const patient = await makePatient(ctx, '6660000024');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );
      await ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 1000, refundedBy: STAFF_ID }));

      await expect(
        ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 1500, refundedBy: STAFF_ID })),
      ).rejects.toThrow(ConflictException);

      const reloaded = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) => manager.getRepository(Deposit).findOneOrFail({ where: { id: deposit.id } })),
      );
      expect(reloaded.balance).toBe(4000);
    });

    it('serializes concurrent same-amount refunds — the balance is decremented exactly once', async () => {
      // P1 row lock + P2 journal pre-check: two truly concurrent refunds of the same amount
      // serialize on the deposit row, the second sees the first's DepositRefund journal and
      // no-ops — the balance is never decremented twice and only one journal exists.
      const patient = await makePatient(ctx, '6660000025');
      const deposit = await ctx.inTenant(() =>
        depositsService.create({ patientId: patient.id, amount: 5000, receivedBy: STAFF_ID }),
      );

      const [first, second] = await Promise.allSettled([
        ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID })),
        ctx.inTenant(() => depositsService.refund(deposit.id, { amount: 2000, refundedBy: STAFF_ID })),
      ]);
      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('fulfilled');

      const reloaded = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema((manager) => manager.getRepository(Deposit).findOneOrFail({ where: { id: deposit.id } })),
      );
      expect(reloaded.balance).toBe(3000); // decremented once, not twice
    });
  });

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

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
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

      const created = await withActor(() =>
        depositsService.create({ patientId: patient.id, amount: 500, receivedBy: spoofed }),
      );
      expect(created.receivedBy).toBe(AUTHENTICATED_ACCOUNT);
    });

    it('refund records the authenticated account as refundedBy, never the spoofed value', async () => {
      const { deposit } = await makePatientWithDeposit(1000);
      const spoofed = '00000000-0000-4000-8000-0000000000ff';

      const refunded = await withActor(() =>
        depositsService.refund(deposit.id, { amount: 100, refundedBy: spoofed }),
      );
      expect(refunded.refundedBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });
});
