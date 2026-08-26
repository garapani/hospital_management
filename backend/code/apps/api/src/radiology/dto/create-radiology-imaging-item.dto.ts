import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateRadiologyImagingItemDto {
  @IsString()
  imagingTypeId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  procedureCode?: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;

  // createItem() (radiology-catalog.service.ts:79-99) saves price with no guard at all, unlike
  // updateItemPrice()/updateItem() which both reject negative prices — this closes that gap,
  // matching the non-negative-price rule enforced everywhere else on this same field.
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
