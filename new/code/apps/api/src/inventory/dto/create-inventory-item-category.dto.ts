import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateInventoryItemCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;
}
