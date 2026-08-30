import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class RunPayrollDto {
  /** 1-12 — mirrors the service guard so the pipe rejects first. */
  @IsNumber()
  @Min(1)
  @Max(12)
  month!: number;

  /** Valid 4-digit year — mirrors the service guard (1900-9999). */
  @IsNumber()
  @Min(1900)
  @Max(9999)
  year!: number;

  /** Optional allowance as a percent of the monthly basic salary (>= 0, default 0). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  allowancePercent?: number;

  /** Optional deduction as a percent of the gross amount (>= 0, <= 100, default 0) — the
   *  service caps at 100 and the DB CHECK backs it (CHK_payslips_net_non_negative). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  deductionPercent?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  processedBy?: string;
}
