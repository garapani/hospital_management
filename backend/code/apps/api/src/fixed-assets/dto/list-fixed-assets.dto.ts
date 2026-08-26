import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { FIXED_ASSET_CONDITIONS } from '../entities/fixed-asset.entity.js';
import type { FixedAssetCondition } from '../entities/fixed-asset.entity.js';

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
