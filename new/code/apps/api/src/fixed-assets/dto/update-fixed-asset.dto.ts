import { IsDateString, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { FIXED_ASSET_CONDITIONS } from '../entities/fixed-asset.entity.js';
import type { FixedAssetCondition } from '../entities/fixed-asset.entity.js';

export class UpdateFixedAssetDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @IsOptional()
  @IsNumber()
  purchaseCost?: number;

  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsIn(FIXED_ASSET_CONDITIONS)
  condition?: FixedAssetCondition;

  @IsOptional()
  @IsNumber()
  usefulLifeYears?: number;

  @IsOptional()
  @IsNumber()
  salvageValue?: number;
}
