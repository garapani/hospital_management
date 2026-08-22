import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class CreateOrderItemDto {
  @IsString()
  itemType!: string;

  @IsString()
  itemDescription!: string;

  @IsOptional()
  @IsString()
  priority?: string;
}

export class CreateOrderDto {
  @IsString()
  patientId!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  orderedBy?: string;

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
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
