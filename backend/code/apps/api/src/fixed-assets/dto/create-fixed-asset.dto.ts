import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { FIXED_ASSET_CONDITIONS } from '../entities/fixed-asset.entity.js';
import type { FixedAssetCondition } from '../entities/fixed-asset.entity.js';

export class CreateFixedAssetDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  purchaseDate!: string;

  @IsNumber()
  purchaseCost!: number;

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
