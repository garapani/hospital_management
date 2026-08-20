import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { FractionRule, FractionEntry } from './entities/fraction.entity.js';

export interface CreateRuleInput {
  doctorId: string;
  departmentId?: string;
  fractionPercent: number;
}

export interface RecordEntryInput {
  invoiceId: string;
  doctorId: string;
  ruleId?: string;
  baseAmount?: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  recordedBy?: string;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Fraction & Incentive (PRD Phase 5): doctor revenue-share rules and the per-invoice share entries
 * computed from them. `recordedBy` derives from the authenticated principal (Development-Standards
 * §25); the caller-supplied value is only a fallback for non-HTTP callers, and recording a share is
 * a money-relevant action where spoofing would be an audit-trail integrity breach.
 */
@Injectable()
export class FractionService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Rules ----------

  async createRule(input: CreateRuleInput): Promise<FractionRule> {
    if (
      !Number.isFinite(input.fractionPercent) ||
      input.fractionPercent <= 0 ||
      input.fractionPercent > 100
    ) {
      throw new BadRequestException('fractionPercent must be greater than 0 and at most 100');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const doctor = await manager.query(`SELECT id FROM accounts WHERE id = $1`, [input.doctorId]);
      if (doctor.length === 0) {
        throw new NotFoundException(`Doctor account ${input.doctorId} not found`);
      }
      return manager.getRepository(FractionRule).save(
        manager.getRepository(FractionRule).create({
          doctorId: input.doctorId,
          departmentId: input.departmentId ?? null,
          fractionPercent: input.fractionPercent,
          isActive: true,
        }),
      );
    });
  }

  async listRules(
    query: PaginationQueryDto & { doctorId?: string },
  ): Promise<PaginatedResponseDto<FractionRule>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(FractionRule).createQueryBuilder('rule');
      if (query.doctorId) {
        qb.andWhere('rule.doctorId = :doctorId', { doctorId: query.doctorId });
      }
      qb.orderBy('rule.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async deactivateRule(id: string): Promise<FractionRule> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FractionRule);
      const rule = await repository.findOne({ where: { id } });
      if (!rule) {
        throw new NotFoundException(`Fraction rule ${id} not found`);
      }
      if (!rule.isActive) {
        throw new ConflictException(`Fraction rule ${id} is already deactivated`);
      }
      rule.isActive = false;
      return repository.save(rule);
    });
  }

  async reactivateRule(id: string): Promise<FractionRule> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FractionRule);
      const rule = await repository.findOne({ where: { id } });
      if (!rule) {
        throw new NotFoundException(`Fraction rule ${id} not found`);
      }
      rule.isActive = true;
      return repository.save(rule);
    });
  }

  // ---------- Entries ----------

  async recordEntry(input: RecordEntryInput): Promise<FractionEntry> {
    const baseAmount = input.baseAmount;
    if (typeof baseAmount !== 'number' || !Number.isFinite(baseAmount) || baseAmount <= 0) {
      throw new BadRequestException('baseAmount must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const invoice = await manager.query(`SELECT id FROM invoices WHERE id = $1`, [input.invoiceId]);
      if (invoice.length === 0) {
        throw new NotFoundException(`Invoice ${input.invoiceId} not found`);
      }

      let fractionPercent: number;
      if (input.ruleId) {
        const rule = await manager.getRepository(FractionRule).findOne({ where: { id: input.ruleId } });
        if (!rule) {
          throw new BadRequestException(`Fraction rule ${input.ruleId} not found`);
        }
        if (!rule.isActive) {
          throw new BadRequestException(`Fraction rule ${input.ruleId} is deactivated`);
        }
        if (rule.doctorId !== input.doctorId) {
          throw new BadRequestException(
            `Fraction rule ${input.ruleId} does not belong to doctor ${input.doctorId}`,
          );
        }
        fractionPercent = rule.fractionPercent;
      } else {
        const rule = await manager.getRepository(FractionRule).findOne({
          where: { doctorId: input.doctorId, departmentId: IsNull(), isActive: true },
        });
        if (!rule) {
          throw new BadRequestException(`No active fraction rule for doctor ${input.doctorId}`);
        }
        fractionPercent = rule.fractionPercent;
      }

      const shareAmount = roundMoney((baseAmount * fractionPercent) / 100);

      return manager.getRepository(FractionEntry).save(
        manager.getRepository(FractionEntry).create({
          invoiceId: input.invoiceId,
          doctorId: input.doctorId,
          fractionPercent,
          baseAmount,
          shareAmount,
          recordedBy: this.resolveActor(input.recordedBy),
        }),
      );
    });
  }

  async listEntries(
    query: PaginationQueryDto & { invoiceId?: string; doctorId?: string },
  ): Promise<PaginatedResponseDto<FractionEntry>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(FractionEntry).createQueryBuilder('entry');
      if (query.invoiceId) {
        qb.andWhere('entry.invoiceId = :invoiceId', { invoiceId: query.invoiceId });
      }
      if (query.doctorId) {
        qb.andWhere('entry.doctorId = :doctorId', { doctorId: query.doctorId });
      }
      qb.orderBy('entry.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getEntry(id: string): Promise<FractionEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const entry = await manager.getRepository(FractionEntry).findOne({ where: { id } });
      if (!entry) {
        throw new NotFoundException(`Fraction entry ${id} not found`);
      }
      return entry;
    });
  }
}
