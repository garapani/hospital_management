import { IsNumber, IsOptional, IsString } from 'class-validator';

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
