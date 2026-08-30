import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

// The only itemType values any downstream workflow module (Lab/Radiology/Pharmacy) recognizes —
// anything else is accepted today, saved, and then silently orphaned (never requisitioned,
// dispensed, or billed).
export const ORDER_ITEM_TYPES = ['Lab', 'Radiology', 'Pharmacy'] as const;

export class CreateOrderItemDto {
  @IsIn(ORDER_ITEM_TYPES)
  itemType!: string;

  @IsString()
  itemDescription!: string;

  @IsOptional()
  @IsString()
  priority?: string;
}

export class CreateOrderDto {
  // uuid columns — a malformed id 500s on the uuid WHERE before the service's not-found path
  // (the §107 write-path-uuid rule; orders was another module the sweep missed).
  @IsUUID()
  patientId!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  orderedBy?: string;

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
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
