import { IsNumber, IsString, IsUUID } from 'class-validator';

export class CreatePharmacyDispensingDto {
  // uuid columns — the §107 write-path-uuid rule.
  @IsUUID()
  orderItemId!: string;

  // uuid column as well.
  @IsUUID()
  inventoryItemId!: string;

  @IsNumber()
  quantity!: number;
}
