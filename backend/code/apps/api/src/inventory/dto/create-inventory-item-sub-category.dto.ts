import { IsBoolean, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateInventoryItemSubCategoryDto {
  @IsUUID()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsBoolean()
  isConsumable?: boolean;
}
