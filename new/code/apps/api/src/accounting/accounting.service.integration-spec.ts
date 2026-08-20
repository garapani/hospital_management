import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingService } from './accounting.service.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountingService (integration)', () => {
  let ctx: TenantTestContext;
  let accountingService: AccountingService;

  const STAFF_ID = '00000000-0000-0000-0000-0000000000e1';
  const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

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
    const cash = await makeAccount('1000', 'Asset');
    const bank = await makeAccount('1010', 'Asset', { parentAccountId: cash.id });
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
    const account = await makeAccount('1100', 'Asset');
    await ctx.inTenant(() => accountingService.deactivateAccount(account.id));
    await expect(ctx.inTenant(() => accountingService.deactivateAccount(account.id))).rejects.toThrow(
      ConflictException,
    );
    await ctx.inTenant(() => accountingService.reactivateAccount(account.id));

    await expect(
      ctx.inTenant(() => accountingService.updateAccount(account.id, { parentAccountId: account.id })),
    ).rejects.toThrow(BadRequestException);
  });

  it('creates a balanced journal and rejects unbalanced entries', async () => {
    const cash = await makeAccount('1000', 'Asset');
    const revenue = await makeAccount('4000', 'Income');

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

  it('derives createdBy/postedBy from the authenticated principal', async () => {
    const cash = await makeAccount('1000', 'Asset');
    const revenue = await makeAccount('4000', 'Income');
    const spoofed = '00000000-0000-0000-0000-0000000000ff';

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
    const cash = await makeAccount('1000', 'Asset');
    const revenue = await makeAccount('4000', 'Income');
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
    const cash = await makeAccountR('1000', 'Asset');
    const bank = await makeAccountR('1010', 'Asset');
    const payable = await makeAccountR('2000', 'Liability');
    const capital = await makeAccountR('3000', 'Equity');
    const revenue = await makeAccountR('4000', 'Income');
    const expense = await makeAccountR('5000', 'Expense');

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
    expect(byCode.get('1000')?.balance).toBe(50000);
    expect(byCode.get('1010')?.balance).toBe(100000);
    expect(byCode.get('2000')?.balance).toBe(-20000);
    expect(byCode.get('3000')?.balance).toBe(-100000);
    expect(byCode.get('4000')?.balance).toBe(-50000);
    expect(byCode.get('5000')?.balance).toBe(20000);
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

  it('enforces tenant isolation', async () => {
    const tenantB = await ctx.createTenant();
    const account = await makeAccount('1000', 'Asset');
    await expect(tenantB.inTenant(() => accountingService.listAccounts())).resolves.not.toContainEqual(
      expect.objectContaining({ id: account.id }),
    );
  });
});
