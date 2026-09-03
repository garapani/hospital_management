import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { CashierShift, DenominationCounts, ModeDeclaredTotals } from './entities/cashier-shift.entity.js';
import { Payment } from './entities/payment.entity.js';
import { roundMoney } from './money.util.js';

/** Standard INR note/coin denominations. A count keyed by anything else is rejected. */
export const CASH_DENOMINATIONS = [500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

export interface OpenShiftInput {
  floatAmount: number;
  notes?: string;
}

export interface CloseShiftInput {
  cashDenominationCounts: DenominationCounts;
  modeDeclaredTotals?: ModeDeclaredTotals;
  notes?: string;
}

export interface ShiftModeReconciliation {
  paymentMode: string;
  expectedAmount: number;
  declaredAmount: number;
  variance: number;
}

export interface ShiftReconciliation {
  shift: CashierShift;
  modes: ShiftModeReconciliation[];
}

function actorId(tenantContext: TenantContextService): string {
  const accountId = tenantContext.getAccountId();
  if (!accountId) {
    throw new ForbiddenException('No authenticated account in context.');
  }
  return accountId;
}

@Injectable()
export class CashierShiftService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async openShift(input: OpenShiftInput): Promise<CashierShift> {
    if (input.floatAmount < 0) {
      throw new BadRequestException('floatAmount cannot be negative.');
    }
    const accountId = actorId(this.tenantContext);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Prevents two concurrent "open shift" clicks/requests from the same account creating two
      // Open rows — the uniqueness check below and the insert would otherwise race.
      await withAdvisoryLock(manager, `cashier_shift_open:${accountId}`);

      const existing = await manager.getRepository(CashierShift).findOne({
        where: { openedBy: accountId, status: 'Open' },
      });
      if (existing) {
        throw new ConflictException(`Account ${accountId} already has an open shift (${existing.id}).`);
      }

      const shift = manager.getRepository(CashierShift).create({
        openedBy: accountId,
        openedAt: new Date(),
        floatAmount: input.floatAmount,
        status: 'Open',
        notes: input.notes ?? null,
      });
      return manager.getRepository(CashierShift).save(shift);
    });
  }

  /** The current account's open shift, or null if it has none. */
  async getCurrentShift(): Promise<CashierShift | null> {
    const accountId = actorId(this.tenantContext);
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(CashierShift).findOne({ where: { openedBy: accountId, status: 'Open' } }),
    );
  }

  async findOne(id: string): Promise<CashierShift> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const shift = await manager.getRepository(CashierShift).findOne({ where: { id } });
      if (!shift) {
        throw new NotFoundException(`Cashier shift ${id} not found`);
      }
      return shift;
    });
  }

  async list(query: PaginationQueryDto): Promise<PaginatedResponseDto<CashierShift>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.createQueryBuilder(CashierShift, 's').orderBy('s.openedAt', 'DESC');
      return paginate(qb, query);
    });
  }

  private cashTotal(counts: DenominationCounts): number {
    let total = 0;
    for (const [denomination, count] of Object.entries(counts)) {
      const value = Number(denomination);
      if (!CASH_DENOMINATIONS.includes(value as (typeof CASH_DENOMINATIONS)[number])) {
        throw new BadRequestException(`Unknown denomination: ${denomination}`);
      }
      if (!Number.isInteger(count) || count < 0) {
        throw new BadRequestException(`Denomination count for ${denomination} must be a non-negative integer.`);
      }
      total += value * count;
    }
    return roundMoney(total);
  }

  private async expectedTotalsByMode(manager: EntityManager, shiftId: string): Promise<Record<string, number>> {
    const rows: { paymentMode: string; total: string }[] = await manager
      .getRepository(Payment)
      .createQueryBuilder('p')
      .select('p.paymentMode', 'paymentMode')
      .addSelect('SUM(p.amount)', 'total')
      .where('p.shiftId = :shiftId', { shiftId })
      .groupBy('p.paymentMode')
      .getRawMany();

    const byMode: Record<string, number> = {};
    for (const row of rows) {
      byMode[row.paymentMode] = roundMoney(Number(row.total));
    }
    return byMode;
  }

  async closeShift(id: string, input: CloseShiftInput): Promise<ShiftReconciliation> {
    const accountId = actorId(this.tenantContext);
    const cashDeclaredTotal = this.cashTotal(input.cashDenominationCounts);
    const modeDeclaredTotals = input.modeDeclaredTotals ?? {};

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CashierShift);
      const shift = await repository.findOne({ where: { id } });
      if (!shift) {
        throw new NotFoundException(`Cashier shift ${id} not found`);
      }
      if (shift.status !== 'Open') {
        throw new ConflictException(`Shift ${id} is already ${shift.status}.`);
      }
      // Only the cashier who opened a shift can close it — a shift is one person's accountable
      // cash drawer, not a shared resource a different staff member should be able to settle.
      if (shift.openedBy !== accountId) {
        throw new ForbiddenException('Only the account that opened this shift can close it.');
      }

      const expected = await this.expectedTotalsByMode(manager, id);

      shift.status = 'Closed';
      shift.closedBy = accountId;
      shift.closedAt = new Date();
      shift.cashDenominationCounts = input.cashDenominationCounts;
      shift.cashDeclaredTotal = cashDeclaredTotal;
      shift.modeDeclaredTotals = modeDeclaredTotals;
      shift.notes = input.notes ?? shift.notes;
      const closed = await repository.save(shift);

      const allModes = new Set([...Object.keys(expected), ...Object.keys(modeDeclaredTotals), 'Cash']);
      const modes: ShiftModeReconciliation[] = [...allModes].map((paymentMode) => {
        const expectedAmount = expected[paymentMode] ?? 0;
        const declaredAmount = paymentMode === 'Cash' ? cashDeclaredTotal : (modeDeclaredTotals[paymentMode] ?? 0);
        return {
          paymentMode,
          expectedAmount,
          declaredAmount,
          variance: roundMoney(declaredAmount - expectedAmount),
        };
      });

      return { shift: closed, modes };
    });
  }

  async getReconciliation(id: string): Promise<ShiftReconciliation> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const shift = await manager.getRepository(CashierShift).findOne({ where: { id } });
      if (!shift) {
        throw new NotFoundException(`Cashier shift ${id} not found`);
      }
      const expected = await this.expectedTotalsByMode(manager, id);
      const declaredCash = shift.cashDeclaredTotal ?? 0;
      const declaredModes = shift.modeDeclaredTotals ?? {};

      const allModes = new Set([...Object.keys(expected), ...Object.keys(declaredModes), 'Cash']);
      const modes: ShiftModeReconciliation[] = [...allModes].map((paymentMode) => {
        const expectedAmount = expected[paymentMode] ?? 0;
        const declaredAmount = paymentMode === 'Cash' ? declaredCash : (declaredModes[paymentMode] ?? 0);
        return {
          paymentMode,
          expectedAmount,
          declaredAmount,
          variance: roundMoney(declaredAmount - expectedAmount),
        };
      });

      return { shift, modes };
    });
  }
}
