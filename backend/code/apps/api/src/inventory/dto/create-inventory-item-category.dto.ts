import { IsInt, IsOptional, IsString } from 'class-validator';

export class CreateInventoryItemCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsInt()
  displaySequence?: number;
}
