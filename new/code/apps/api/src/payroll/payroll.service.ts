import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { Payslip, PayslipStatus } from './entities/payslip.entity.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { LEDGER_ACCOUNT_IDS } from '../accounting/ledger-account-codes.js';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface RunPayrollConfig {
  /** Allowance as a percent of the monthly basic salary (>= 0, default 0). */
  allowancePercent?: number;
  /** Deduction as a percent of the gross amount (>= 0, default 0). */
  deductionPercent?: number;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  processedBy?: string;
}

export interface ListPayslipsQuery extends PaginationQueryDto {
  employeeId?: string;
  month?: number;
  year?: number;
  status?: PayslipStatus;
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
    private readonly accountingService: AccountingService,
  ) {}

  /**
   * `processedBy` derives from the authenticated principal (see §25) — the caller-supplied value
   * is only a fallback for non-HTTP callers, and payslip generation/marking-paid are the
   * money-relevant actions where spoofing would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  /**
   * Runs the monthly payroll: for every ACTIVE employee, computes basic + allowance = gross,
   * gross * deductionPercent = deduction, and stores a Draft payslip snapshot. Re-runs are
   * idempotent — an employee who already has a payslip for (month, year) is skipped rather than
   * failing the whole run. Returns the payslips created by this run.
   */
  async runMonthlyPayroll(month: number, year: number, config: RunPayrollConfig = {}): Promise<Payslip[]> {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      throw new BadRequestException('year must be an integer between 1900 and 9999');
    }
    const allowancePercent = config.allowancePercent ?? 0;
    const deductionPercent = config.deductionPercent ?? 0;
    if (!Number.isFinite(allowancePercent) || allowancePercent < 0) {
      throw new BadRequestException('allowancePercent must be a non-negative number');
    }
    // deductionPercent is capped at 100: a deduction larger than the gross would produce a
    // negative net payslip (no CHECK constraint previously stood in the way;
    // code-review-findings-2026-08-25 P2 — the DB-level backstop is CHK_payslips_net_non_negative,
    // migration 0085).
    if (!Number.isFinite(deductionPercent) || deductionPercent < 0 || deductionPercent > 100) {
      throw new BadRequestException('deductionPercent must be between 0 and 100');
    }
    const processedBy = this.resolveActor(config.processedBy);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Serializes concurrent runs for the same month/year: the second run waits, then its
      // duplicate pre-check sees the first run's committed payslips and skips them — instead of
      // both runs observing "no payslip yet" and the loser aborting the WHOLE run on the unique
      // (employeeId, periodMonth, periodYear) violation (code-review-findings-2026-08-25 P2).
      await withAdvisoryLock(manager, `payroll:${month}:${year}`);

      // Soft-delete filter: an employee's payslips must not be generated after the employee was
      // removed (P3) — the raw query must re-apply TypeORM's deletedAt IS NULL itself.
      const employees: { id: string; monthlyBasicSalary: string | number }[] = await manager.query(
        `SELECT id, "monthlyBasicSalary" FROM employees WHERE "isActive" = true AND "deletedAt" IS NULL`,
      );

      // Batch-load every existing payslip for the period once (kills the per-employee N+1, P3),
      // then skip in-memory.
      const existing = await manager.getRepository(Payslip).find({
        where: { periodMonth: month, periodYear: year },
      });
      const existingByEmployee = new Set(existing.map((p) => p.employeeId));

      const repository = manager.getRepository(Payslip);
      const created: Payslip[] = [];
      for (const employee of employees) {
        if (existingByEmployee.has(employee.id)) {
          continue;
        }
        const basic = roundMoney(Number(employee.monthlyBasicSalary) || 0);
        const allowance = roundMoney((basic * allowancePercent) / 100);
        const gross = roundMoney(basic + allowance);
        const deduction = roundMoney((gross * deductionPercent) / 100);
        const net = roundMoney(gross - deduction);
        created.push(
          await repository.save(
            repository.create({
              employeeId: employee.id,
              periodMonth: month,
              periodYear: year,
              basicAmount: basic,
              allowanceAmount: allowance,
              grossAmount: gross,
              deductionAmount: deduction,
              netAmount: net,
              status: 'Draft',
              processedBy,
              paidAt: null,
              notes: config.notes ?? null,
            }),
          ),
        );
      }
      return created;
    });
  }

  /** Draft -> Paid: marks the payslip paid (row-locked) and posts the payroll journal — Salary
   *  Expense / Salaries Payable for the net amount, the money-moving moment
   *  (code-review-findings-2026-08-25 P2). Deduction-side liabilities (PF/ESI etc.) are a larger
   *  payroll-accounting model, not this fix. Fails loud: a payslip that can't be booked should
   *  not silently look paid. */
  async markPaid(id: string, actor?: string): Promise<Payslip> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Payslip);
      const payslip = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!payslip) {
        throw new NotFoundException(`Payslip ${id} not found`);
      }
      if (payslip.status !== 'Draft') {
        throw new ConflictException(`Payslip ${id} cannot move from ${payslip.status} to Paid`);
      }
      payslip.status = 'Paid';
      payslip.paidAt = new Date();
      payslip.processedBy = this.resolveActor(actor);
      const paid = await repository.save(payslip);

      await this.accountingService.postAutoJournal(manager, {
        sourceType: 'Payslip',
        sourceId: paid.id,
        entryDate: new Date().toISOString().slice(0, 10),
        narration: `Payslip ${paid.id}: ${paid.periodMonth}/${paid.periodYear} net payable`,
        actor: paid.processedBy,
        lines: [
          { accountId: LEDGER_ACCOUNT_IDS.SALARY_EXPENSE, debit: paid.netAmount },
          { accountId: LEDGER_ACCOUNT_IDS.SALARIES_PAYABLE, credit: paid.netAmount },
        ],
      });

      return paid;
    });
  }

  async listPayslips(query: ListPayslipsQuery = {}): Promise<PaginatedResponseDto<Payslip>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(Payslip).createQueryBuilder('payslip');
      if (query.employeeId) {
        qb.andWhere('payslip.employeeId = :employeeId', { employeeId: query.employeeId });
      }
      if (query.month !== undefined) {
        qb.andWhere('payslip.periodMonth = :month', { month: query.month });
      }
      if (query.year !== undefined) {
        qb.andWhere('payslip.periodYear = :year', { year: query.year });
      }
      if (query.status) {
        qb.andWhere('payslip.status = :status', { status: query.status });
      }
      qb.orderBy('payslip.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getPayslip(id: string): Promise<Payslip> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const payslip = await manager.getRepository(Payslip).findOne({ where: { id } });
      if (!payslip) {
        throw new NotFoundException(`Payslip ${id} not found`);
      }
      return payslip;
    });
  }
}
