import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';
import { LEDGER_ACCOUNT_IDS } from './ledger-account-codes.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountingService (integration)', () => {
  let ctx: TenantTestContext;
  let accountingService: AccountingService;

  const STAFF_ID = '00000000-0000-4000-8000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-4000-8000-0000000000aa';

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounting' });
    accountingService = new AccountingService(
      ctx.tenantConnection,
      new JournalNumberGeneratorService(ctx.tenantConnection),
      ctx.tenantContext,
    );
  });

  afterAll(() => teardownTenantTestContext(ctx));

  function withActor<T>(work: () => Promise<T>): Promise<T> {
    return ctx.tenantContext.run(
      { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'accounting-test' },
      work,
    );
  }

  let seq = 0;
  async function makeAccount(code: string, type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense', overrides: Record<string, unknown> = {}) {
    return ctx.inTenant(() =>
      accountingService.createAccount({
        accountCode: code,
        name: `${type} ${code}${++seq}`,
        type,
        ...overrides,
      }),
    );
  }

  it('creates accounts, validates type, and enforces parent references', async () => {
    const cash = await makeAccount('6100', 'Asset');
    const bank = await makeAccount('6110', 'Asset', { parentAccountId: cash.id });
    expect(bank.parentAccountId).toBe(cash.id);

    await expect(
      ctx.inTenant(() => accountingService.createAccount({ accountCode: 'X', name: 'Bad', type: 'Intangible' as never })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      ctx.inTenant(() =>
        accountingService.createAccount({ accountCode: 'X', name: 'NoParent', type: 'Asset', parentAccountId: '00000000-0000-0000-0000-000000000000' }),
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('soft-deletes accounts and rejects self-parenting', async () => {
    const account = await makeAccount('6200', 'Asset');
    await ctx.inTenant(() => accountingService.deactivateAccount(account.id));
    await expect(ctx.inTenant(() => accountingService.deactivateAccount(account.id))).rejects.toThrow(
      ConflictException,
    );
    await ctx.inTenant(() => accountingService.reactivateAccount(account.id));

    await expect(
      ctx.inTenant(() => accountingService.updateAccount(account.id, { parentAccountId: account.id })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a duplicate accountCode with ConflictException', async () => {
    const account = await makeAccount('6300', 'Asset');
    await expect(
      ctx.inTenant(() =>
        accountingService.createAccount({ accountCode: account.accountCode, name: 'Duplicate', type: 'Asset' }),
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects changing the type of an account that has journal entries', async () => {
    const cash = await makeAccount('6400', 'Asset');
    const revenue = await makeAccount('7410', 'Income');
    await ctx.inTenant(() =>
      accountingService.createJournal({
        entryDate: '2025-06-01',
        lines: [
          { accountId: cash.id, debit: 100 },
          { accountId: revenue.id, credit: 100 },
        ],
        createdBy: STAFF_ID,
      }),
    );

    await expect(
      ctx.inTenant(() => accountingService.updateAccount(cash.id, { type: 'Expense' })),
    ).rejects.toThrow(ConflictException);

    // An un-journaled account can still change type.
    const fresh = await makeAccount('6401', 'Asset');
    const changed = await ctx.inTenant(() =>
      accountingService.updateAccount(fresh.id, { type: 'Expense' }),
    );
    expect(changed.type).toBe('Expense');
  });

  it('protects the seeded system accounts from type changes and deactivation', async () => {
    const systemId = LEDGER_ACCOUNT_IDS.PATIENT_ACCOUNTS_RECEIVABLE;
    await expect(
      ctx.inTenant(() => accountingService.updateAccount(systemId, { type: 'Expense' })),
    ).rejects.toThrow(ConflictException);
    await expect(
      ctx.inTenant(() => accountingService.deactivateAccount(systemId)),
    ).rejects.toThrow(ConflictException);
    // Cosmetic name edits remain allowed.
    const renamed = await ctx.inTenant(() =>
      accountingService.updateAccount(systemId, { name: 'Patient AR (renamed)' }),
    );
    expect(renamed.name).toBe('Patient AR (renamed)');
  });

  it('creates a balanced journal and rejects unbalanced entries', async () => {
    const cash = await makeAccount('6500', 'Asset');
    const revenue = await makeAccount('7500', 'Income');

    const journal = await ctx.inTenant(() =>
      accountingService.createJournal({
        entryDate: '2025-06-01',
        narration: 'OPD cash collection',
        lines: [
          { accountId: cash.id, debit: 1500 },
          { accountId: revenue.id, credit: 1500 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    expect(journal.status).toBe('Draft');
    expect(journal.journalNumber).toMatch(/^JRN-\d{4}-\d+$/);
    expect(journal.lines).toHaveLength(2);
    expect(journal.createdBy).toBe(STAFF_ID);

    await expect(
      ctx.inTenant(() =>
        accountingService.createJournal({
          entryDate: '2025-06-01',
          lines: [
            { accountId: cash.id, debit: 1500 },
            { accountId: revenue.id, credit: 1400 },
          ],
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/does not balance/);
    await expect(
      ctx.inTenant(() =>
        accountingService.createJournal({
          entryDate: '2025-06-01',
          lines: [{ accountId: cash.id, debit: 500 }],
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/at least two lines/);
    await expect(
      ctx.inTenant(() =>
        accountingService.createJournal({
          entryDate: '2025-06-01',
          lines: [
            { accountId: cash.id, debit: 0, credit: 0 },
            { accountId: revenue.id, credit: 100 },
          ],
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/non-zero/);
  });

  it('rejects a manual journal referencing an unknown or deactivated account', async () => {
    const cash = await makeAccount('6600', 'Asset');
    const revenue = await makeAccount('7600', 'Income');
    await ctx.inTenant(() => accountingService.deactivateAccount(revenue.id));

    // Unknown account id: previously created a journal_lines row with no matching
    // ledger_accounts row (no FK on that column) — trialBalance's `if (!account) return null`
    // silently dropped it from every report instead of erroring.
    await expect(
      ctx.inTenant(() =>
        accountingService.createJournal({
          entryDate: '2025-06-01',
          lines: [
            { accountId: cash.id, debit: 500 },
            { accountId: '00000000-0000-0000-0000-000000000000', credit: 500 },
          ],
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/not found/);

    // Deactivated account.
    await expect(
      ctx.inTenant(() =>
        accountingService.createJournal({
          entryDate: '2025-06-01',
          lines: [
            { accountId: cash.id, debit: 500 },
            { accountId: revenue.id, credit: 500 },
          ],
          createdBy: STAFF_ID,
        }),
      ),
    ).rejects.toThrow(/inactive/);
  });

  it('derives createdBy/postedBy from the authenticated principal', async () => {
    const cash = await makeAccount('6700', 'Asset');
    const revenue = await makeAccount('7700', 'Income');
    const spoofed = '00000000-0000-4000-8000-0000000000ff';

    const journal = await withActor(() =>
      accountingService.createJournal({
        entryDate: '2025-06-02',
        lines: [
          { accountId: cash.id, debit: 2000 },
          { accountId: revenue.id, credit: 2000 },
        ],
        createdBy: spoofed,
      }),
    );
    expect(journal.createdBy).toBe(AUTHENTICATED_ACCOUNT);

    const posted = await withActor(() => accountingService.postJournal(journal.id));
    expect(posted.status).toBe('Posted');
    expect(posted.postedBy).toBe(AUTHENTICATED_ACCOUNT);
    expect(posted.postedAt).not.toBeNull();
  });

  it('locks a posted journal — no further transitions', async () => {
    const cash = await makeAccount('6800', 'Asset');
    const revenue = await makeAccount('7800', 'Income');
    const journal = await ctx.inTenant(() =>
      accountingService.createJournal({
        entryDate: '2025-06-03',
        lines: [
          { accountId: cash.id, debit: 100 },
          { accountId: revenue.id, credit: 100 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    await ctx.inTenant(() => accountingService.postJournal(journal.id));
    await expect(ctx.inTenant(() => accountingService.postJournal(journal.id))).rejects.toThrow(
      ConflictException,
    );
  });

  describe('postAutoJournal', () => {
    it('generates sequential journal numbers using the caller-supplied manager, not a second connection', async () => {
      // Regression test for the P1 fix: postAutoJournal used to generate its journal number via
      // JournalNumberGeneratorService, which opens its own runInTenantSchema — a second pooled
      // connection/transaction — while running on a manager that (in production callers like
      // recordPayment) is already mid-transaction. This proves postAutoJournal works end-to-end
      // when invoked exactly that way: on an already-open manager, inside a transaction.
      const cash = await makeAccount('6900', 'Asset');
      const revenue = await makeAccount('7900', 'Income');

      const [first, second] = await ctx.inTenant(() =>
        ctx.tenantConnection.runInTenantSchema(async (manager) => {
          const a = await accountingService.postAutoJournal(manager, {
            sourceType: 'Test',
            sourceId: '00000000-0000-4000-8000-000000000001',
            entryDate: '2025-06-04',
            lines: [
              { accountId: cash.id, debit: 100 },
              { accountId: revenue.id, credit: 100 },
            ],
            actor: STAFF_ID,
          });
          const b = await accountingService.postAutoJournal(manager, {
            sourceType: 'Test',
            sourceId: '00000000-0000-4000-8000-000000000002',
            entryDate: '2025-06-04',
            lines: [
              { accountId: cash.id, debit: 200 },
              { accountId: revenue.id, credit: 200 },
            ],
            actor: STAFF_ID,
          });
          return [a, b];
        }),
      );

      expect(first.status).toBe('Posted');
      expect(second.status).toBe('Posted');
      expect(first.journalNumber).toMatch(/^JRN-\d{4}-\d+$/);
      expect(second.journalNumber).not.toBe(first.journalNumber);
    });

    it('rejects an auto-posted journal referencing an unknown or deactivated account', async () => {
      const cash = await makeAccount('6910', 'Asset');
      const revenue = await makeAccount('7910', 'Income');
      await ctx.inTenant(() => accountingService.deactivateAccount(revenue.id));

      await expect(
        ctx.inTenant(() =>
          ctx.tenantConnection.runInTenantSchema((manager) =>
            accountingService.postAutoJournal(manager, {
              sourceType: 'Test',
              sourceId: '00000000-0000-4000-8000-000000000003',
              entryDate: '2025-06-04',
              lines: [
                { accountId: cash.id, debit: 50 },
                { accountId: revenue.id, credit: 50 },
              ],
              actor: STAFF_ID,
            }),
          ),
        ),
      ).rejects.toThrow(/inactive/);
    });
  });

  it('computes the trial balance, income statement, and balance sheet (hermetically, in its own tenant)', async () => {
    // Reports aggregate the whole tenant, so this test runs in a dedicated tenant to keep the
    // numbers free of the other tests' journals (and it doubles as a tenant-isolation proof).
    const reportCtx = await ctx.createTenant();
    const reportService = new AccountingService(
      ctx.tenantConnection,
      new JournalNumberGeneratorService(ctx.tenantConnection),
      reportCtx.tenantContext,
    );
    const inReport = <T>(work: () => Promise<T>): Promise<T> =>
      reportCtx.tenantContext.run({ tenantId: reportCtx.tenantId, correlationId: 'report' }, work);

    const makeAccountR = (code: string, type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense') =>
      inReport(() => reportService.createAccount({ accountCode: code, name: type, type }));
    const cash = await makeAccountR('6100', 'Asset');
    const bank = await makeAccountR('6110', 'Asset');
    const payable = await makeAccountR('6200', 'Liability');
    const capital = await makeAccountR('6300', 'Equity');
    const revenue = await makeAccountR('6400', 'Income');
    const expense = await makeAccountR('6500', 'Expense');

    // Capital injection: bank 100000 debit, capital 100000 credit.
    const capitalJournal = await inReport(() =>
      reportService.createJournal({
        entryDate: '2025-01-01',
        lines: [
          { accountId: bank.id, debit: 100000 },
          { accountId: capital.id, credit: 100000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    // Purchase on credit: cash 0 / expense 20000 debit, payable 20000 credit.
    const expenseJournal = await inReport(() =>
      reportService.createJournal({
        entryDate: '2025-02-01',
        lines: [
          { accountId: expense.id, debit: 20000 },
          { accountId: payable.id, credit: 20000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    // Revenue: cash 50000 debit, revenue 50000 credit.
    const revenueJournal = await inReport(() =>
      reportService.createJournal({
        entryDate: '2025-03-01',
        lines: [
          { accountId: cash.id, debit: 50000 },
          { accountId: revenue.id, credit: 50000 },
        ],
        createdBy: STAFF_ID,
      }),
    );

    // Post exactly this test's three journals.
    for (const j of [capitalJournal, expenseJournal, revenueJournal]) {
      await inReport(() => reportService.postJournal(j.id));
    }

    const trial = await inReport(() => reportService.trialBalance());
    const byCode = new Map(trial.map((r) => [r.accountCode, r]));
    expect(byCode.get('6100')?.balance).toBe(50000);
    expect(byCode.get('6110')?.balance).toBe(100000);
    expect(byCode.get('6200')?.balance).toBe(-20000);
    expect(byCode.get('6300')?.balance).toBe(-100000);
    expect(byCode.get('6400')?.balance).toBe(-50000);
    expect(byCode.get('6500')?.balance).toBe(20000);
    // Trial balance sums to zero.
    expect(trial.reduce((s, r) => s + r.balance, 0)).toBe(0);

    const income = await inReport(() => reportService.incomeStatement('2025-01-01', '2025-12-31'));
    expect(income.income).toHaveLength(1);
    expect(income.income[0].amount).toBe(50000);
    expect(income.expenses).toHaveLength(1);
    expect(income.expenses[0].amount).toBe(20000);
    expect(income.netIncome).toBe(30000);

    const sheet = await inReport(() => reportService.balanceSheet('2025-12-31'));
    expect(sheet.totalAssets).toBe(150000);
    expect(sheet.totalLiabilitiesAndEquity).toBe(150000); // 20000 payable + 100000 capital + 30000 retained
  });

  it('excludes soft-deleted journals from the trial balance', async () => {
    // The trial-balance SQL is raw (not repository-based), so it used to bypass TypeORM's
    // soft-delete filter — a soft-deleted journal kept moving report totals while every
    // repository-based read (listJournals etc.) had already excluded it (P3). Runs in its own
    // tenant like the report test above.
    const reportCtx = await ctx.createTenant();
    const reportService = new AccountingService(
      ctx.tenantConnection,
      new JournalNumberGeneratorService(ctx.tenantConnection),
      reportCtx.tenantContext,
    );
    const inReport = <T>(work: () => Promise<T>): Promise<T> =>
      reportCtx.tenantContext.run({ tenantId: reportCtx.tenantId, correlationId: 'report' }, work);
    const makeAccountR = (code: string, type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense') =>
      inReport(() => reportService.createAccount({ accountCode: code, name: type, type }));
    const cash = await makeAccountR('6100', 'Asset');
    const revenue = await makeAccountR('6400', 'Income');

    const journal = await inReport(() =>
      reportService.createJournal({
        entryDate: '2025-06-01',
        lines: [
          { accountId: cash.id, debit: 1000 },
          { accountId: revenue.id, credit: 1000 },
        ],
        createdBy: STAFF_ID,
      }),
    );
    await inReport(() => reportService.postJournal(journal.id, STAFF_ID));

    const before = await inReport(() => reportService.trialBalance());
    expect(before.find((r) => r.accountId === cash.id)?.debitTotal).toBe(1000);

    // Soft-delete the journal (raw update — there is no delete endpoint for journals).
    await inReport(() =>
      reportCtx.tenantConnection.runInTenantSchema((manager) =>
        manager.query(
          `UPDATE journal_entries SET "deletedAt" = now(), "deletedBy" = $1 WHERE id = $2`,
          [STAFF_ID, journal.id],
        ),
      ),
    );

    const after = await inReport(() => reportService.trialBalance());
    expect(after.find((r) => r.accountId === cash.id)).toBeUndefined();
  });

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const account = await makeAccount('6920', 'Asset');
    await expect(tenantB.inTenant(() => accountingService.listAccounts())).resolves.not.toContainEqual(
      expect.objectContaining({ id: account.id }),
    );
  });
});
