import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Deposit } from './entities/deposit.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { roundMoney } from './money.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { AccountingService } from '../accounting/accounting.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import { JournalEntry, JournalLine } from '../accounting/entities/journal-entry.entity.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateDepositInput {
  patientId: string;
  amount: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  receivedBy?: string;
  notes?: string;
}

export interface RefundDepositInput {
  amount: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  refundedBy?: string;
}

@Injectable()
export class DepositsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
    private readonly accountingService: AccountingService,
  ) {}

  /**
   * Actor fields (`receivedBy`, `refundedBy`) are never trusted from the caller: the authenticated
   * principal (TenantContextService.accountId, set by TenantContextMiddleware from the verified
   * JWT) wins; the passed value is only a fallback for non-HTTP callers (service specs) that run
   * without a tenant context. These fields are money-movement audit markers, so spoofing them
   * would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async create(input: CreateDepositInput): Promise<Deposit> {
    if (input.amount <= 0) {
      throw new BadRequestException('Deposit amount must be greater than zero');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
      if (!patient) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }
      const repository = manager.getRepository(Deposit);
      const deposit = await repository.save(
        repository.create({
          patientId: input.patientId,
          amount: input.amount,
          balance: input.amount,
          receivedBy: this.resolveActor(input.receivedBy),
          notes: input.notes ?? null,
        }),
      );

      // Backs the Patient Deposits Payable liability that a later Deposit-sourced payment settles
      // — without this, that settlement would debit a liability that was never credited. Fails
      // loud, same as the other billing-to-accounting hooks.
      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'Deposit',
        sourceId: deposit.id,
        entryDate: today(),
        narration: `Deposit received for patient ${input.patientId}`,
        actor: deposit.receivedBy,
        lines: [
          { accountId: LEDGER_ACCOUNT_IDS.CASH_AND_BANK, debit: input.amount },
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE, credit: input.amount },
        ],
      });

      return deposit;
    });
  }

  async list(query: PaginationQueryDto & { patientId?: string }): Promise<PaginatedResponseDto<Deposit>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(Deposit).createQueryBuilder('deposit');
      
      if (query.patientId) {
        qb.andWhere('deposit.patientId = :patientId', { patientId: query.patientId });
      }

      qb.orderBy('deposit.receivedAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async refund(id: string, input: RefundDepositInput): Promise<Deposit> {
    if (input.amount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Deposit);
      // Row-locked like recordPayment's invoice lookup: without this, two concurrent refunds (or
      // a refund racing a Deposit-sourced payment, which does lock) can both read the same
      // balance and each subtract from it, paying out more cash than the deposit ever held
      // (code-review-findings-2026-08-25 P1).
      const deposit = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!deposit) {
        throw new NotFoundException(`Deposit ${id} not found`);
      }

      // Idempotency: Deposit has no per-refund identity (only one refundedBy/refundedAt pair
      // despite the method allowing repeated partial refunds), so a retried request is
      // indistinguishable from a deliberate second refund except by amount. Checked here, BEFORE
      // any mutation, by mirroring AccountingService.postAutoJournal's own (sourceType, sourceId)
      // dedup (accounting.service.ts) rather than relying on it after the fact: previously the
      // balance was decremented unconditionally and only the journal call afterward detected a
      // same-amount retry (as a safe no-op) — so a double-submitted refund moved real balance
      // twice while the ledger only ever showed it once (code-review-findings-2026-08-25 P2). A
      // different-amount collision against an existing refund still fails loud, now before any
      // mutation instead of via a rollback triggered later by the journal call.
      const existingJournal = await manager.getRepository(JournalEntry).findOne({
        where: { sourceType: 'DepositRefund', sourceId: id },
      });
      if (existingJournal) {
        const existingLines = await manager
          .getRepository(JournalLine)
          .find({ where: { journalId: existingJournal.id } });
        const isSameAmountRetry = existingLines.some(
          (line) =>
            line.accountId === LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE &&
            roundMoney(line.debit) === roundMoney(input.amount),
        );
        if (isSameAmountRetry) {
          return deposit;
        }
        throw new ConflictException(`Deposit ${id} already has a refund recorded with a different amount`);
      }

      if (input.amount > deposit.balance) {
        throw new BadRequestException(`Refund amount ${input.amount} exceeds deposit balance ${deposit.balance}`);
      }
      deposit.balance = roundMoney(deposit.balance - input.amount);
      deposit.refundedBy = this.resolveActor(input.refundedBy);
      deposit.refundedAt = new Date();
      const saved = await repository.save(deposit);

      // sourceId is the deposit id, not a per-refund id: Deposit has no separate refund-event
      // record. By this point the pre-check above has already ruled out both a same-amount retry
      // (returned early) and a different-amount collision (thrown) against an existing refund
      // journal for this deposit, so this call always posts a genuinely new entry.
      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'DepositRefund',
        sourceId: id,
        entryDate: today(),
        narration: `Refund for deposit ${id}`,
        actor: saved.refundedBy ?? undefined,
        lines: [
          { accountId: LEDGER_ACCOUNT_IDS.PATIENT_DEPOSITS_PAYABLE, debit: input.amount },
          { accountId: LEDGER_ACCOUNT_IDS.CASH_AND_BANK, credit: input.amount },
        ],
      });

      return saved;
    });
  }
}
