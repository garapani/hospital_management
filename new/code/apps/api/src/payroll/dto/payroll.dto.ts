import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { PayslipStatus } from '../entities/payslip.entity.js';

export class RunPayrollDto {
  /** 1-12. */
  @IsNumber()
  month!: number;

  /** Valid 4-digit year. */
  @IsNumber()
  year!: number;

  /** Optional allowance as a percent of the monthly basic salary (>= 0, default 0). */
  @IsOptional()
  @IsNumber()
  allowancePercent?: number;

  /** Optional deduction as a percent of the gross amount (>= 0, default 0). */
  @IsOptional()
  @IsNumber()
  deductionPercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  processedBy?: string;
}

export class MarkPaidDto {
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  processedBy?: string;
}

export class ListPayslipsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @IsOptional()
  @IsIn(['Draft', 'Paid'])
  status?: PayslipStatus;
}
