import { IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateRadiologyImagingItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  procedureCode?: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;

  /** Selling price in INR; null = not priced yet. */
  @IsOptional()
  @IsNumber()
  price?: number;
}
