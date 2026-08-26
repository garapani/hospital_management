import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { OtSurgeryStatus } from '../entities/ot-surgery.entity.js';

export class CreateSurgeryDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  admissionId?: string;

  @IsString()
  procedureName!: string;

  @IsOptional()
  @IsString()
  otRoom?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  surgeonId?: string;

  @IsOptional()
  @IsString()
  anesthesiologistId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CompleteSurgeryDto {
  @IsOptional()
  @IsString()
  postOpNotes?: string;
}

export class CancelSurgeryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// Extends PaginationQueryDto (not hand-rolled @IsNumber() page/limit) so page/limit stay @IsInt(),
// matching every other list DTO in the app — a non-integer limit would otherwise reach
// paginate()'s .skip()/.take() as a float, which Postgres rejects with a 500 instead of the
// clean 400 every sibling endpoint returns for the same malformed input.
export class ListSurgeriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['Scheduled', 'InProgress', 'Completed', 'Cancelled'])
  status?: OtSurgeryStatus;

  @IsOptional()
  @IsUUID()
  patientId?: string;
}
