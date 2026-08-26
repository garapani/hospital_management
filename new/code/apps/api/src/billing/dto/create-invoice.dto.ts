import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateInvoiceItemDto {
  @IsString()
  description!: string;

  @IsOptional()
  @IsString()
  hsnSacCode?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsNumber()
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  taxPercent?: number;

  @IsOptional()
  @IsString()
  sourceOrderItemId?: string;
}

export class CreateInvoiceDto {
  @IsString()
  patientId!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsString()
  sourceAppointmentId?: string;

  @IsOptional()
  @IsString()
  sourceAdmissionId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items!: CreateInvoiceItemDto[];
}
