import { IsNumber, IsString } from 'class-validator';

export class CreatePharmacyDispensingDto {
  @IsString()
  orderItemId!: string;

  @IsString()
  inventoryItemId!: string;

  @IsNumber()
  quantity!: number;
}
