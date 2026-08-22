import { PaginationQueryDto } from '@hospital/pagination';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRuleDto {
  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsNumber()
  fractionPercent!: number;
}

export class CreateEntryDto {
  @IsString()
  invoiceId!: string;

  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsNumber()
  baseAmount?: number;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  recordedBy?: string;
}

export class ListRulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  doctorId?: string;
}

export class ListEntriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;
}
