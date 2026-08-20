import { FixedAssetCondition } from '../entities/fixed-asset.entity.js';

export class CreateFixedAssetCategoryDto {
  name!: string;
}

export class CreateFixedAssetDto {
  categoryId!: string;
  name!: string;
  description?: string;
  purchaseDate!: string;
  purchaseCost!: number;
  supplierName?: string;
  departmentId?: string;
  condition?: FixedAssetCondition;
  usefulLifeYears?: number;
  salvageValue?: number;
}

export class UpdateFixedAssetDto {
  name?: string;
  description?: string;
  purchaseDate?: string;
  purchaseCost?: number;
  supplierName?: string;
  departmentId?: string;
  condition?: FixedAssetCondition;
  usefulLifeYears?: number;
  salvageValue?: number;
}
