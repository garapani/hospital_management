import { IsNumber, IsUUID } from 'class-validator';

export class CreatePharmacyDispensingDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
  orderItemId!: string;

  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  quantity!: number;
}
