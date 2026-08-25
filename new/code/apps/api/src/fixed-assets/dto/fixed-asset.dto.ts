import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import { FIXED_ASSET_CONDITIONS } from '../entities/fixed-asset.entity.js';
import type { FixedAssetCondition } from '../entities/fixed-asset.entity.js';

export class CreateFixedAssetCategoryDto {
  @IsString()
  name!: string;
}

export class CreateFixedAssetDto {
  @IsString()
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

// Was previously bound in the controller as `PaginationQueryDto & { categoryId?: string;
// condition?: FixedAssetCondition }` — an inline intersection type with no runtime class, so Nest
// couldn't resolve a metatype for it and skipped validation entirely regardless of `whitelist`
// (see 2.14 Phase B / claude-code-tasks.md 2.18). A real `extends`-based class fixes that.
export class ListFixedAssetsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(FIXED_ASSET_CONDITIONS)
  condition?: FixedAssetCondition;
}

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

export class RunDepreciationDto {
  /** 1-12. */
  @IsNumber()
  month!: number;

  /** Valid 4-digit year. */
  @IsNumber()
  year!: number;
}

export class ListDepreciationEntriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;
}
