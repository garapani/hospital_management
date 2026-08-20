import { PaginationQueryDto } from '@hospital/pagination';
import { PayslipStatus } from '../entities/payslip.entity.js';

export class RunPayrollDto {
  /** 1-12. */
  month!: number;
  /** Valid 4-digit year. */
  year!: number;
  /** Optional allowance as a percent of the monthly basic salary (>= 0, default 0). */
  allowancePercent?: number;
  /** Optional deduction as a percent of the gross amount (>= 0, default 0). */
  deductionPercent?: number;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  processedBy?: string;
}

export class MarkPaidDto {
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  processedBy?: string;
}

export class ListPayslipsQueryDto extends PaginationQueryDto {
  employeeId?: string;
  month?: number;
  year?: number;
  status?: PayslipStatus;
}
