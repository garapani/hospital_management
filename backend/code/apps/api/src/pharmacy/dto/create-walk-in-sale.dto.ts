import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateWalkInSaleDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
  patientId!: string;

  // uuid column as well.
  @IsUUID()
  inventoryItemId!: string;

  @IsNumber()
  quantity!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  dispensedBy?: string;
}
