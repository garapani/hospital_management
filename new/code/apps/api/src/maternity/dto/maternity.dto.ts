import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

import type { DeliveryType } from '../entities/maternity-record.entity.js';

const DELIVERY_TYPES = ['Normal', 'C-Section', 'Instrumental'] as const;

export class CreateMaternityRecordDto {
  @IsString()
  admissionId!: string;

  @IsString()
  patientId!: string;

  @IsOptional()
  @IsNumber()
  gravida?: number;

  @IsOptional()
  @IsNumber()
  para?: number;

  @IsOptional()
  @IsDateString()
  lmp?: string;

  @IsOptional()
  @IsDateString()
  edd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateMaternityRecordDto {
  @IsOptional()
  @IsNumber()
  gravida?: number;

  @IsOptional()
  @IsNumber()
  para?: number;

  @IsOptional()
  @IsDateString()
  lmp?: string;

  @IsOptional()
  @IsDateString()
  edd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordDeliveryDto {
  @IsDateString()
  deliveryDate!: string;

  @IsIn(DELIVERY_TYPES)
  deliveryType!: DeliveryType;

  @IsNumber()
  babyCount!: number;

  @IsOptional()
  @IsString()
  complications?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListMaternityRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;
}
