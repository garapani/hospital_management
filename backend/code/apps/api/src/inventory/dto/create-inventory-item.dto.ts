import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInventoryItemDto {
  @IsUUID()
  subCategoryId!: string;

  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsString()
  unitOfMeasure!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reorderLevel?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;
}
