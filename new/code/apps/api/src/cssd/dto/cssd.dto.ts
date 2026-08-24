import { IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { SterilizationCycleStatus, SterilizationMethod } from '../entities/cssd.entity.js';

export class CreateInstrumentDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  // int column, default 0 — a negative/decimal value would corrupt sterile-instrument-set counts.
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

export class UpdateInstrumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  // int column, default 0 — a negative/decimal value would corrupt sterile-instrument-set counts.
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}

export class StartCycleDto {
  @IsString()
  instrumentId!: string;

  @IsIn(['Steam', 'ETO', 'Chemical'])
  method!: SterilizationMethod;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  operatedBy?: string;
}

export class CompleteCycleDto {
  @IsNumber()
  sterileHours!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  operatedBy?: string;
}

export class FailCycleDto {
  @IsString()
  failureReason!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  operatedBy?: string;
}

// Was previously bound in the controller as `PaginationQueryDto & ListCyclesQueryDto` — an
// intersection of two classes has no single runtime constructor, so Nest couldn't resolve a
// metatype for it and skipped validation entirely regardless of `whitelist` (see 2.14 Phase B /
// claude-code-tasks.md 2.18). Extending directly fixes that.
export class ListCyclesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  instrumentId?: string;

  @IsOptional()
  @IsIn(['InProgress', 'Completed', 'Failed'])
  status?: SterilizationCycleStatus;
}
