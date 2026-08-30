import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  // Money surface: a negative unit price would flow straight into the invoice total and the
  // revenue journal — rejected at the pipe (the discounts/tax fields already carry @Min(0)).
  @IsNumber()
  @Min(0)
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
  @IsUUID()
  sourceOrderItemId?: string;
}

export class CreateInvoiceDto {
  // uuid columns — a malformed id 500s on the FK/WHERE before the service's 404 can run
  // (the §107 write-path-uuid rule).
  @IsUUID()
  patientId!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsUUID()
  sourceAppointmentId?: string;

  @IsOptional()
  @IsUUID()
  sourceAdmissionId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items!: CreateInvoiceItemDto[];
}
