import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Deposit } from './entities/deposit.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { roundMoney } from './money.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';

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
      return repository.save(
        repository.create({
          patientId: input.patientId,
          amount: input.amount,
          balance: input.amount,
          receivedBy: this.resolveActor(input.receivedBy),
          notes: input.notes ?? null,
        }),
      );
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
      return repository.save(deposit);
    });
  }
}
