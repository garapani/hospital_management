import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Deposit } from './entities/deposit.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { roundMoney } from './money.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';

export interface CreateDepositInput {
  patientId: string;
  amount: number;
  receivedBy: string;
  notes?: string;
}

export interface RefundDepositInput {
  amount: number;
  refundedBy: string;
}

@Injectable()
export class DepositsService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

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
          receivedBy: input.receivedBy,
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
      deposit.refundedBy = input.refundedBy;
      deposit.refundedAt = new Date();
      return repository.save(deposit);
    });
  }
}
