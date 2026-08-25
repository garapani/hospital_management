import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Deposit } from './entities/deposit.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { roundMoney } from './money.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { AccountingService } from '../accounting/accounting.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';

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
      const deposit = await repository.findOne({ where: { id } });
      if (!deposit) {
        throw new NotFoundException(`Deposit ${id} not found`);
      }
      if (input.amount > deposit.balance) {
        throw new BadRequestException(`Refund amount ${input.amount} exceeds deposit balance ${deposit.balance}`);
      }
      deposit.balance = roundMoney(deposit.balance - input.amount);
      deposit.refundedBy = this.resolveActor(input.refundedBy);
      deposit.refundedAt = new Date();
      const saved = await repository.save(deposit);

      // sourceId is the deposit id, not a per-refund id: Deposit has no separate refund-event
      // record (only one refundedBy/refundedAt pair). A second, same-amount refund against the
      // same deposit is treated as a safe retry (postAutoJournal no-ops); a second, DIFFERENT-
      // amount refund is a genuine conflict on a reused source key and fails loud
      // (ConflictException) — surfacing that pre-existing data-model gap rather than silently
      // mis-booking it. Documented out-of-scope limitation; see Development-Standards.md.
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
