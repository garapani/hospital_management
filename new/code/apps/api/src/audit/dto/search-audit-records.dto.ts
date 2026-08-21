import { IsOptional, IsString, IsEnum, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchAuditRecordsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  tableName?: string;

  @IsOptional()
  @IsEnum(['create', 'update', 'delete'])
  action?: 'create' | 'update' | 'delete';

  @IsOptional()
  @IsString()
  changedByAccountId?: string;

  @IsOptional()
  @IsString()
  recordId?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
