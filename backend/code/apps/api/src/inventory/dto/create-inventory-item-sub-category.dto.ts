import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateInventoryItemSubCategoryDto {
  @IsString()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isConsumable?: boolean;
}
