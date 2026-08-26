import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, In, QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  AccountType,
  ACCOUNT_TYPES,
  LedgerAccount,
} from './entities/ledger-account.entity.js';
import { JournalEntry, JournalLine } from './entities/journal-entry.entity.js';
import { JournalNumberGeneratorService } from './journal-number-generator.service.js';
import { LEDGER_ACCOUNT_IDS } from './ledger-account-codes.js';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface CreateAccountInput {
  accountCode: string;
  name: string;
  type: AccountType;
  parentAccountId?: string;
}

export interface UpdateAccountInput {
  name?: string;
  type?: AccountType;
  parentAccountId?: string | null;
}

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  lineNarration?: string;
}

export interface CreateJournalInput {
  entryDate: string;
  narration?: string;
  lines: JournalLineInput[];
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  createdBy?: string;
}

export interface AutoPostJournalInput {
  /** e.g. 'Payment', 'Deposit', 'DepositRefund', 'Return', 'InvoiceItem'. */
  sourceType: string;
  sourceId: string;
  entryDate: string;
  narration?: string;
  lines: JournalLineInput[];
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  actor?: string;
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitTotal: number;
  creditTotal: number;
  /** debitTotal - creditTotal (a negative balance is a credit-side balance). */
  balance: number;
}

export interface IncomeStatementRow {
  accountCode: string;
  accountName: string;
  amount: number;
}

export interface BalanceSheetRow {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  /** Debit balance for Asset accounts; credit balance for Liability/Equity. */
  amount: number;
}

@Injectable()
export class AccountingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly journalNumberGenerator: JournalNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  /** The seeded system accounts are load-bearing for billing's auto-posted journals (fixed ids
   *  in ledger-account-codes.ts) — they are structural, not ordinary chart-of-accounts rows. */
  private isSystemAccount(id: string): boolean {
    return Object.values(LEDGER_ACCOUNT_IDS).includes(id as (typeof LEDGER_ACCOUNT_IDS)[keyof typeof LEDGER_ACCOUNT_IDS]);
  }

  // ---------- Chart of accounts ----------

  async createAccount(input: CreateAccountInput): Promise<LedgerAccount> {
    if (!input.accountCode?.trim() || !input.name?.trim()) {
      throw new BadRequestException('accountCode and name are required');
    }
    if (!ACCOUNT_TYPES.includes(input.type)) {
      throw new BadRequestException(`Account type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      if (input.parentAccountId) {
        const parent = await manager.getRepository(LedgerAccount).findOne({ where: { id: input.parentAccountId } });
        if (!parent) {
          throw new NotFoundException(`Parent account ${input.parentAccountId} not found`);
        }
      }
      const repository = manager.getRepository(LedgerAccount);
      try {
        return await repository.save(
          repository.create({
            accountCode: input.accountCode.trim(),
            name: input.name.trim(),
            type: input.type,
            parentAccountId: input.parentAccountId ?? null,
          }),
        );
      } catch (error) {
        // ledger_accounts.accountCode is unique (migration 0082) — a duplicate code would
        // otherwise surface as a raw 500 (code-review-findings-2026-08-25 P3).
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint === 'UQ_ledger_accounts_accountCode'
        ) {
          throw new ConflictException(`Ledger account code ${input.accountCode.trim()} is already in use`);
        }
        throw error;
      }
    });
  }

  async listAccounts(): Promise<LedgerAccount[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LedgerAccount).find({ order: { accountCode: 'ASC' } }),
    );
  }

  async updateAccount(id: string, input: UpdateAccountInput): Promise<LedgerAccount> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LedgerAccount);
      const account = await repository.findOne({ where: { id } });
      if (!account) {
        throw new NotFoundException(`Ledger account ${id} not found`);
      }
      if (input.type !== undefined && !ACCOUNT_TYPES.includes(input.type)) {
        throw new BadRequestException(`Account type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
      }
      // An account's type is structural: changing it after journals reference the account would
      // silently re-classify history in every report (trial balance / income statement / balance
      // sheet), and the system accounts are load-bearing for billing's auto-posted journals — a
      // type change there is never legitimate (code-review-findings-2026-08-25 accounting P2).
      if (input.type !== undefined && input.type !== account.type) {
        if (this.isSystemAccount(id)) {
          throw new ConflictException(`Ledger account ${id} is a system account; its type cannot be changed`);
        }
        const journaled = await manager.query(
          `SELECT 1 FROM journal_lines WHERE "accountId" = $1 LIMIT 1`,
          [id],
        );
        if (journaled.length > 0) {
          throw new ConflictException(
            `Ledger account ${id} has journal entries; its type cannot be changed`,
          );
        }
      }
      if (input.name !== undefined) account.name = input.name;
      if (input.type !== undefined) account.type = input.type;
      if (input.parentAccountId !== undefined) {
        if (input.parentAccountId === id) {
          throw new BadRequestException('An account cannot be its own parent');
        }
        if (input.parentAccountId) {
          const parent = await manager.getRepository(LedgerAccount).findOne({ where: { id: input.parentAccountId } });
          if (!parent) {
            throw new NotFoundException(`Parent account ${input.parentAccountId} not found`);
          }
        }
        account.parentAccountId = input.parentAccountId;
      }
      return repository.save(account);
    });
  }

  async deactivateAccount(id: string): Promise<LedgerAccount> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LedgerAccount);
      const account = await repository.findOne({ where: { id } });
      if (!account) {
        throw new NotFoundException(`Ledger account ${id} not found`);
      }
      if (this.isSystemAccount(id)) {
        throw new ConflictException(
          `Ledger account ${id} is a system account used by automatic billing journals; it cannot be deactivated`,
        );
      }
      if (!account.isActive) {
        throw new ConflictException(`Ledger account ${id} is already deactivated`);
      }
      account.isActive = false;
      return repository.save(account);
    });
  }

  async reactivateAccount(id: string): Promise<LedgerAccount> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LedgerAccount);
      const account = await repository.findOne({ where: { id } });
      if (!account) {
        throw new NotFoundException(`Ledger account ${id} not found`);
      }
      account.isActive = true;
      return repository.save(account);
    });
  }

  // ---------- Journal entries ----------

  async createJournal(input: CreateJournalInput): Promise<JournalEntry & { lines: JournalLine[] }> {
    if (!input.lines || input.lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines (double-entry)');
    }
    const normalized = this.validateAndNormalizeLines(input.lines);
    const journalNumber = await this.journalNumberGenerator.generateNextJournalNumber();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Manual journals previously had no check that each accountId actually exists: a typo'd or
      // stale id inserted a journal_lines row with no matching ledger_accounts row (no FK on that
      // column), and trialBalance's `if (!account) return null` silently dropped it from every
      // report instead of erroring — debits could permanently diverge from credits with no alert
      // (code-review-findings-2026-08-25 P1). postAutoJournal already had this check; manual
      // journals now share it.
      await this.assertAccountsUsable(manager, normalized);

      const journalRepository = manager.getRepository(JournalEntry);
      const journal = await journalRepository.save(
        journalRepository.create({
          journalNumber,
          entryDate: input.entryDate,
          narration: input.narration ?? null,
          status: 'Draft',
          createdBy: this.resolveActor(input.createdBy),
          postedBy: null,
          postedAt: null,
        }),
      );

      const lineRepository = manager.getRepository(JournalLine);
      const lines = await lineRepository.save(
        normalized.map((line) =>
          lineRepository.create({
            journalId: journal.id,
            accountId: line.accountId,
            debit: line.debit,
            credit: line.credit,
            lineNarration: line.lineNarration ?? null,
          }),
        ),
      );

      return { ...journal, lines };
    });
  }

  /**
   * Draft -> Posted: validates the lines still balance, then marks immutable. A posted entry can
   * never be edited or reversed in-place — corrections are new entries (named future item).
   */
  async postJournal(id: string, actor?: string): Promise<JournalEntry & { lines: JournalLine[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Row-locked like every other status mutator in the codebase: two concurrent postJournal
      // calls must serialize, not both observe 'Draft' and double-post
      // (code-review-findings-2026-08-25 accounting P2).
      const journal = await this.loadJournal(manager, id, true);
      if (journal.status !== 'Draft') {
        throw new ConflictException(`Journal entry ${id} is already ${journal.status}`);
      }
      const lines = await manager.getRepository(JournalLine).find({ where: { journalId: id } });
      this.assertBalanced(lines);
      journal.status = 'Posted';
      journal.postedBy = this.resolveActor(actor);
      journal.postedAt = new Date();
      await manager.getRepository(JournalEntry).save(journal);
      return { ...journal, lines };
    });
  }

  /**
   * Automatic posting hook for billing (payments, deposits, returns, charge-capture revenue) and
   * any future source. Runs on the CALLER's EntityManager — no own transaction — so it commits
   * atomically with whatever billing write triggered it, mirroring
   * InvoicesService.captureChargeForOrderItem's manager-passing pattern.
   *
   * Idempotent: looks up an existing journal by (sourceType, sourceId) first. If one exists with
   * the same lines (same accounts, same debit/credit amounts), it's a safe retry — returned
   * unchanged, no duplicate posted. If one exists with DIFFERENT lines, that source key was reused
   * for a genuinely different event (e.g. a second refund against the same deposit, which has no
   * distinct per-refund identity — see DepositsService.refund) — this is a conflict, not a retry,
   * and throws rather than silently dropping the second event on the floor. Skips Draft entirely:
   * auto-posted journals are created directly as Posted, since there is no human review step for
   * system-generated entries (reversals are new correcting entries, per the existing no-reversal
   * convention).
   *
   * Fails loud: an unbalanced input, a mapped account that is missing/inactive (an accounting
   * configuration bug), or a source-key conflict as above, all throw rather than silently posting
   * nothing or posting a broken entry. Callers that need best-effort semantics (documented
   * exception: charge-capture revenue, to match ChargeCaptureSubscriber's "never roll back a
   * clinical completion" rule) catch and log at the call site — this method itself never swallows.
   */
  async postAutoJournal(
    manager: EntityManager,
    input: AutoPostJournalInput,
  ): Promise<JournalEntry & { lines: JournalLine[] }> {
    if (!input.lines || input.lines.length < 2) {
      throw new BadRequestException('A journal entry needs at least two lines (double-entry)');
    }
    const normalized = this.validateAndNormalizeLines(input.lines);

    const journalRepository = manager.getRepository(JournalEntry);
    const existing = await journalRepository.findOne({
      where: { sourceType: input.sourceType, sourceId: input.sourceId },
    });
    if (existing) {
      const existingLines = await manager.getRepository(JournalLine).find({ where: { journalId: existing.id } });
      if (!this.linesMatch(normalized, existingLines)) {
        throw new ConflictException(
          `A journal already exists for source ${input.sourceType}:${input.sourceId} with different amounts — refusing to post a conflicting duplicate`,
        );
      }
      return { ...existing, lines: existingLines };
    }

    // No FK constraint on journal_lines.accountId (matches the rest of the accounting schema), so
    // an unmapped/mistyped account id would otherwise insert a silently-orphaned line. Auto-posted
    // journals are never reviewed by a human before going Posted, so this check is what stands
    // between a misconfigured mapping and a broken ledger.
    await this.assertAccountsUsable(manager, normalized);

    // Generates the journal number against the CALLER's manager, not via
    // JournalNumberGeneratorService: that service opens its own runInTenantSchema — a brand-new
    // pooled connection and transaction — but postAutoJournal always runs on a manager that's
    // already mid-transaction (recordPayment/createReturn/deposit flows hold a row lock at this
    // point). Every concurrent caller doing that at once can exhaust the pool with connections
    // each waiting on one more connection that never frees up (code-review-findings-2026-08-25
    // P1) — the same "generate the number against the caller's own manager" pattern
    // InvoicesService.generateInvoiceNumber already uses for exactly this reason.
    const journalNumber = await this.generateJournalNumberInTransaction(manager);
    const actor = this.resolveActor(input.actor);
    const now = new Date();

    const journal = await journalRepository.save(
      journalRepository.create({
        journalNumber,
        entryDate: input.entryDate,
        narration: input.narration ?? null,
        status: 'Posted',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        createdBy: actor,
        postedBy: actor,
        postedAt: now,
      }),
    );

    const lineRepository = manager.getRepository(JournalLine);
    const lines = await lineRepository.save(
      normalized.map((line) =>
        lineRepository.create({
          journalId: journal.id,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          lineNarration: line.lineNarration ?? null,
        }),
      ),
    );

    return { ...journal, lines };
  }

  async listJournals(
    query: PaginationQueryDto & { status?: 'Draft' | 'Posted'; from?: string; to?: string },
  ): Promise<PaginatedResponseDto<JournalEntry>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(JournalEntry).createQueryBuilder('journal');
      if (query.status) {
        qb.andWhere('journal.status = :status', { status: query.status });
      }
      if (query.from) {
        qb.andWhere('journal."entryDate" >= :from', { from: query.from });
      }
      if (query.to) {
        qb.andWhere('journal."entryDate" <= :to', { to: query.to });
      }
      qb.orderBy('journal.entryDate', 'DESC').addOrderBy('journal.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getJournal(id: string): Promise<JournalEntry & { lines: JournalLine[] }> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const journal = await this.loadJournal(manager, id);
      const lines = await manager.getRepository(JournalLine).find({
        where: { journalId: id },
        order: { createdAt: 'ASC' },
      });
      return { ...journal, lines };
    });
  }

  /** Throws if any line references an account that doesn't exist or is deactivated. Shared by
   *  createJournal and postAutoJournal so neither path can post an orphaned journal_lines row. */
  private async assertAccountsUsable(
    manager: EntityManager,
    lines: { accountId: string }[],
  ): Promise<void> {
    const accountIds = [...new Set(lines.map((line) => line.accountId))];
    const accounts = await manager.getRepository(LedgerAccount).find({ where: { id: In(accountIds) } });
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const missing = accountIds.filter((id) => !accountsById.has(id));
    if (missing.length > 0) {
      throw new ConflictException(`Ledger account(s) not found: ${missing.join(', ')}`);
    }
    const inactive = accounts.filter((account) => !account.isActive);
    if (inactive.length > 0) {
      throw new ConflictException(
        `Ledger account(s) inactive: ${inactive.map((account) => account.accountCode).join(', ')}`,
      );
    }
  }

  /** Same sequence table/prefix as JournalNumberGeneratorService (journal_sequences, 'JRN'), but
   *  run against the caller's own manager instead of opening a separate connection — see the
   *  comment at its call site in postAutoJournal. */
  private async generateJournalNumberInTransaction(manager: EntityManager): Promise<string> {
    const currentYear = new Date().getFullYear();
    const result = await manager.query(
      `
      INSERT INTO journal_sequences (prefix, year, "lastSequence")
      VALUES ($1, $2, 1)
      ON CONFLICT (prefix, year)
      DO UPDATE SET "lastSequence" = journal_sequences."lastSequence" + 1
      RETURNING "lastSequence"
      `,
      ['JRN', currentYear],
    );
    const nextSeq = result[0].lastSequence as number;
    return `JRN-${currentYear}-${String(nextSeq).padStart(5, '0')}`;
  }

  private async loadJournal(manager: EntityManager, id: string, lock = false): Promise<JournalEntry> {
    const journal = await manager.getRepository(JournalEntry).findOne({
      where: { id },
      ...(lock ? { lock: { mode: 'pessimistic_write' } as const } : {}),
    });
    if (!journal) {
      throw new NotFoundException(`Journal entry ${id} not found`);
    }
    return journal;
  }

  private linesMatch(
    normalized: { accountId: string; debit: number; credit: number }[],
    existing: JournalLine[],
  ): boolean {
    if (normalized.length !== existing.length) {
      return false;
    }
    const key = (l: { accountId: string; debit: number; credit: number }): string =>
      `${l.accountId}:${l.debit}:${l.credit}`;
    const a = normalized.map(key).sort();
    const b = existing.map((l) => key({ accountId: l.accountId, debit: l.debit, credit: l.credit })).sort();
    return a.every((value, i) => value === b[i]);
  }

  private validateAndNormalizeLines(
    lines: JournalLineInput[],
  ): { accountId: string; debit: number; credit: number; lineNarration?: string }[] {
    const normalized = lines.map((line) => {
      const debit = line.debit === undefined ? 0 : Number(line.debit);
      const credit = line.credit === undefined ? 0 : Number(line.credit);
      if (!Number.isFinite(debit) || !Number.isFinite(credit)) {
        throw new BadRequestException('Line amounts must be numbers');
      }
      if (debit < 0 || credit < 0) {
        throw new BadRequestException('Line amounts cannot be negative');
      }
      if (debit > 0 && credit > 0) {
        throw new BadRequestException('A journal line cannot have both debit and credit');
      }
      if (debit === 0 && credit === 0) {
        throw new BadRequestException('A journal line must have a non-zero debit or credit');
      }
      return { accountId: line.accountId, debit, credit, lineNarration: line.lineNarration };
    });

    const totalDebit = roundMoney(normalized.reduce((sum, l) => sum + l.debit, 0));
    const totalCredit = roundMoney(normalized.reduce((sum, l) => sum + l.credit, 0));
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Journal does not balance: total debit ${totalDebit} != total credit ${totalCredit}`,
      );
    }

    return normalized;
  }

  private assertBalanced(lines: JournalLine[]): void {
    const totalDebit = roundMoney(lines.reduce((sum, l) => sum + l.debit, 0));
    const totalCredit = roundMoney(lines.reduce((sum, l) => sum + l.credit, 0));
    if (totalDebit !== totalCredit) {
      throw new ConflictException('Journal is unbalanced and cannot be posted');
    }
  }

  // ---------- Reports ----------

  /** Per-account debit/credit totals over POSTED journals in the period. */
  async trialBalance(from?: string, to?: string): Promise<TrialBalanceRow[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Sums stay numeric (not float8 — float8 can silently drop cents on large money sums,
      // code-review-findings-2026-08-25 accounting P2), and the join applies the same
      // soft-delete filter the repository-based reads get (`deletedAt IS NULL` — the raw SQL
      // bypassed TypeORM's soft-delete machinery, P3).
      const rows: { accountId: string; d: string; c: string }[] = await manager.query(
        `SELECT l."accountId" AS "accountId",
                COALESCE(SUM(l.debit), 0)::numeric AS d,
                COALESCE(SUM(l.credit), 0)::numeric AS c
         FROM journal_lines l
         JOIN journal_entries j ON j.id = l."journalId"
         WHERE j.status = 'Posted'
           AND j."deletedAt" IS NULL
           AND ($1::date IS NULL OR j."entryDate" >= $1)
           AND ($2::date IS NULL OR j."entryDate" <= $2)
         GROUP BY l."accountId"`,
        [from ?? null, to ?? null],
      );
      const accounts = await manager.getRepository(LedgerAccount).find();
      const byId = new Map(accounts.map((a) => [a.id, a]));
      return rows
        .map((row) => {
          const account = byId.get(row.accountId);
          if (!account) return null;
          const d = Number(row.d);
          const c = Number(row.c);
          return {
            accountId: account.id,
            accountCode: account.accountCode,
            accountName: account.name,
            accountType: account.type,
            debitTotal: roundMoney(d),
            creditTotal: roundMoney(c),
            balance: roundMoney(d - c),
          };
        })
        .filter((row): row is TrialBalanceRow => row !== null)
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    });
  }

  /** Revenue (Income) and expenses (Expense) over POSTED journals in the period. */
  async incomeStatement(from?: string, to?: string): Promise<{
    income: IncomeStatementRow[];
    expenses: IncomeStatementRow[];
    netIncome: number;
  }> {
    const trial = await this.trialBalance(from, to);

    // Income accounts carry credit balances (negative trial balance); the income statement
    // reports them as positive revenue. Expense accounts carry debit balances (positive) and are
    // reported as positive expenses.
    const income = trial
      .filter((row) => row.accountType === 'Income' && row.balance !== 0)
      .map((row) => ({ accountCode: row.accountCode, accountName: row.accountName, amount: -row.balance }));
    const expenses = trial
      .filter((row) => row.accountType === 'Expense' && row.balance !== 0)
      .map((row) => ({ accountCode: row.accountCode, accountName: row.accountName, amount: row.balance }));
    const netIncome = roundMoney(
      income.reduce((s, r) => s + r.amount, 0) - expenses.reduce((s, r) => s + r.amount, 0),
    );
    return { income, expenses, netIncome };
  }

  /** Assets vs Liabilities+Equity as of the given date (defaults to today). */
  async balanceSheet(asOf?: string): Promise<{
    assets: BalanceSheetRow[];
    liabilitiesAndEquity: BalanceSheetRow[];
    totalAssets: number;
    totalLiabilitiesAndEquity: number;
  }> {
    const to = asOf ?? new Date().toISOString().slice(0, 10);
    const trial = await this.trialBalance(undefined, to);
    const assets = trial
      .filter((row) => row.accountType === 'Asset')
      .map((row) => ({ accountCode: row.accountCode, accountName: row.accountName, accountType: row.accountType, amount: row.balance }));
    const liabilitiesAndEquity = trial
      .filter((row) => row.accountType === 'Liability' || row.accountType === 'Equity')
      .map((row) => ({ accountCode: row.accountCode, accountName: row.accountName, accountType: row.accountType, amount: -row.balance }));
    // Retained earnings: net income accumulated through the as-of date keeps the sheet balanced
    // (assets = liabilities + equity + retained earnings).
    const { netIncome } = await this.incomeStatement(undefined, to);
    if (netIncome !== 0) {
      liabilitiesAndEquity.push({
        accountCode: 'RETAINED',
        accountName: 'Retained Earnings',
        accountType: 'Equity',
        amount: netIncome,
      });
    }
    return {
      assets,
      liabilitiesAndEquity,
      totalAssets: roundMoney(assets.reduce((s, r) => s + r.amount, 0)),
      totalLiabilitiesAndEquity: roundMoney(liabilitiesAndEquity.reduce((s, r) => s + r.amount, 0)),
    };
  }
}
