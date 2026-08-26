import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import type { DeliveryType } from '../entities/maternity-record.entity.js';

const DELIVERY_TYPES = ['Normal', 'C-Section', 'Instrumental'] as const;

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
