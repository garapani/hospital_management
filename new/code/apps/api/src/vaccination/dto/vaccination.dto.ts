import { IsDateString, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class CreateVaccinationRecordDto {
  @IsString()
  patientId!: string;

  @IsString()
  vaccine!: string;

  @IsOptional()
  @IsNumber()
  doseNumber?: number;

  /** ISO date (YYYY-MM-DD) on which the dose was administered. */
  @IsDateString()
  administeredDate!: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  administeredBy?: string;
}

export class ListVaccinationRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsString()
  vaccine?: string;
}
