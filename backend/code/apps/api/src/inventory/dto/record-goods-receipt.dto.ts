import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordGoodsReceiptDto {
  @IsString()
  batchNumber!: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsNumber()
  @Min(0)
  unitCost!: number;

  @IsOptional()
  @IsNumber()
  mrp?: number;

  @IsNumber()
  receivedQuantity!: number;

  @IsOptional()
  @IsString()
  recordedBy?: string;
}
