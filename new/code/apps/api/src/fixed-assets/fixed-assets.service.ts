import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { FixedAssetNumberGeneratorService } from './fixed-asset-number-generator.service.js';
import { FixedAsset, FixedAssetCondition, FIXED_ASSET_CONDITIONS } from './entities/fixed-asset.entity.js';
import { FixedAssetCategory } from './entities/fixed-asset-category.entity.js';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';

export interface CreateFixedAssetCategoryInput {
  name: string;
}

export interface CreateFixedAssetInput {
  categoryId: string;
  name: string;
  description?: string;
  purchaseDate: string;
  purchaseCost: number;
  supplierName?: string;
  departmentId?: string;
  condition?: FixedAssetCondition;
  usefulLifeYears?: number;
  salvageValue?: number;
}

export interface UpdateFixedAssetInput {
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

export interface FixedAssetValuation {
  purchaseCost: number;
  salvageValue: number;
  usefulLifeYears: number | null;
  monthsInService: number;
  annualDepreciation: number | null;
  accumulatedDepreciation: number;
  bookValue: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Straight-line depreciation, computed on read: annualDepreciation = (cost - salvage) / usefulLife;
 * accumulated = annualDepreciation * (full months in service / 12), capped at (cost - salvage).
 * `null` usefulLifeYears => no depreciation accrues (annualDepreciation null, bookValue = cost).
 */
export function computeStraightLineValuation(
  asset: Pick<FixedAsset, 'purchaseDate' | 'purchaseCost' | 'usefulLifeYears' | 'salvageValue'>,
  asOf: Date = new Date(),
): FixedAssetValuation {
  const purchaseDate = new Date(asset.purchaseDate);
  const monthsInService = Math.max(
    0,
    (asOf.getFullYear() - purchaseDate.getFullYear()) * 12 +
      (asOf.getMonth() - purchaseDate.getMonth()),
  );

  if (asset.usefulLifeYears === null) {
    return {
      purchaseCost: asset.purchaseCost,
      salvageValue: asset.salvageValue,
      usefulLifeYears: null,
      monthsInService,
      annualDepreciation: null,
      accumulatedDepreciation: 0,
      bookValue: asset.purchaseCost,
    };
  }

  const depreciableBase = Math.max(0, asset.purchaseCost - asset.salvageValue);
  const annualDepreciation = roundMoney(depreciableBase / asset.usefulLifeYears);
  const accumulatedDepreciation = roundMoney(
    Math.min(annualDepreciation * (monthsInService / 12), depreciableBase),
  );
  return {
    purchaseCost: asset.purchaseCost,
    salvageValue: asset.salvageValue,
    usefulLifeYears: asset.usefulLifeYears,
    monthsInService,
    annualDepreciation,
    accumulatedDepreciation,
    bookValue: roundMoney(asset.purchaseCost - accumulatedDepreciation),
  };
}

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly assetNumberGenerator: FixedAssetNumberGeneratorService,
  ) {}

  async createCategory(input: CreateFixedAssetCategoryInput): Promise<FixedAssetCategory> {
    if (!input.name?.trim()) {
      throw new BadRequestException('Category name is required');
    }
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(FixedAssetCategory).save(
        manager.getRepository(FixedAssetCategory).create({ name: input.name.trim() }),
      ),
    );
  }

  async listCategories(): Promise<FixedAssetCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(FixedAssetCategory).find({ order: { name: 'ASC' } }),
    );
  }

  async deactivateCategory(id: string): Promise<FixedAssetCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FixedAssetCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Fixed asset category ${id} not found`);
      }
      if (!category.isActive) {
        throw new ConflictException(`Fixed asset category ${id} is already deactivated`);
      }
      category.isActive = false;
      return repository.save(category);
    });
  }

  async reactivateCategory(id: string): Promise<FixedAssetCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FixedAssetCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Fixed asset category ${id} not found`);
      }
      category.isActive = true;
      return repository.save(category);
    });
  }

  async createAsset(input: CreateFixedAssetInput): Promise<FixedAsset> {
    if (!Number.isFinite(input.purchaseCost) || input.purchaseCost < 0) {
      throw new BadRequestException('purchaseCost must be a non-negative number');
    }
    if (input.usefulLifeYears !== undefined && (!Number.isFinite(input.usefulLifeYears) || input.usefulLifeYears <= 0)) {
      throw new BadRequestException('usefulLifeYears must be a positive number when provided');
    }
    if (input.salvageValue !== undefined && (!Number.isFinite(input.salvageValue) || input.salvageValue < 0)) {
      throw new BadRequestException('salvageValue must be a non-negative number');
    }
    if (input.condition && !FIXED_ASSET_CONDITIONS.includes(input.condition)) {
      throw new BadRequestException(`condition must be one of: ${FIXED_ASSET_CONDITIONS.join(', ')}`);
    }

    const assetCode = await this.assetNumberGenerator.generateNextAssetCode();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const category = await manager.getRepository(FixedAssetCategory).findOne({ where: { id: input.categoryId } });
      if (!category) {
        throw new NotFoundException(`Fixed asset category ${input.categoryId} not found`);
      }
      if (!category.isActive) {
        throw new ConflictException(`Fixed asset category ${input.categoryId} is deactivated; cannot register assets under it`);
      }

      return manager.getRepository(FixedAsset).save(
        manager.getRepository(FixedAsset).create({
          assetCode,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          purchaseDate: input.purchaseDate,
          purchaseCost: input.purchaseCost,
          supplierName: input.supplierName ?? null,
          departmentId: input.departmentId ?? null,
          condition: input.condition ?? 'In Service',
          usefulLifeYears: input.usefulLifeYears ?? null,
          salvageValue: input.salvageValue ?? 0,
        }),
      );
    });
  }

  async listAssets(query: PaginationQueryDto & { categoryId?: string; condition?: FixedAssetCondition }): Promise<PaginatedResponseDto<FixedAsset>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(FixedAsset).createQueryBuilder('asset');
      if (query.categoryId) {
        qb.andWhere('asset.categoryId = :categoryId', { categoryId: query.categoryId });
      }
      if (query.condition) {
        qb.andWhere('asset.condition = :condition', { condition: query.condition });
      }
      qb.orderBy('asset.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getAsset(id: string): Promise<FixedAsset> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const asset = await manager.getRepository(FixedAsset).findOne({ where: { id } });
      if (!asset) {
        throw new NotFoundException(`Fixed asset ${id} not found`);
      }
      return asset;
    });
  }

  /** Straight-line valuation as of today (stateless; always reflects the current date). */
  async getAssetValuation(id: string): Promise<FixedAssetValuation> {
    const asset = await this.getAsset(id);
    return computeStraightLineValuation(asset);
  }

  async updateAsset(id: string, input: UpdateFixedAssetInput): Promise<FixedAsset> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FixedAsset);
      const asset = await repository.findOne({ where: { id } });
      if (!asset) {
        throw new NotFoundException(`Fixed asset ${id} not found`);
      }
      if (input.condition !== undefined) {
        if (!FIXED_ASSET_CONDITIONS.includes(input.condition)) {
          throw new BadRequestException(`condition must be one of: ${FIXED_ASSET_CONDITIONS.join(', ')}`);
        }
        asset.condition = input.condition;
      }
      if (input.purchaseCost !== undefined) {
        if (!Number.isFinite(input.purchaseCost) || input.purchaseCost < 0) {
          throw new BadRequestException('purchaseCost must be a non-negative number');
        }
        asset.purchaseCost = input.purchaseCost;
      }
      if (input.usefulLifeYears !== undefined) {
        if (input.usefulLifeYears !== null && (!Number.isFinite(input.usefulLifeYears) || input.usefulLifeYears <= 0)) {
          throw new BadRequestException('usefulLifeYears must be a positive number');
        }
        asset.usefulLifeYears = input.usefulLifeYears;
      }
      if (input.salvageValue !== undefined) {
        if (!Number.isFinite(input.salvageValue) || input.salvageValue < 0) {
          throw new BadRequestException('salvageValue must be a non-negative number');
        }
        asset.salvageValue = input.salvageValue;
      }
      if (input.name !== undefined) asset.name = input.name;
      if (input.description !== undefined) asset.description = input.description;
      if (input.purchaseDate !== undefined) asset.purchaseDate = input.purchaseDate;
      if (input.supplierName !== undefined) asset.supplierName = input.supplierName;
      if (input.departmentId !== undefined) asset.departmentId = input.departmentId;
      return repository.save(asset);
    });
  }

  async deactivateAsset(id: string): Promise<FixedAsset> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FixedAsset);
      const asset = await repository.findOne({ where: { id } });
      if (!asset) {
        throw new NotFoundException(`Fixed asset ${id} not found`);
      }
      if (!asset.isActive) {
        throw new ConflictException(`Fixed asset ${id} is already deactivated`);
      }
      asset.isActive = false;
      return repository.save(asset);
    });
  }

  async reactivateAsset(id: string): Promise<FixedAsset> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(FixedAsset);
      const asset = await repository.findOne({ where: { id } });
      if (!asset) {
        throw new NotFoundException(`Fixed asset ${id} not found`);
      }
      asset.isActive = true;
      return repository.save(asset);
    });
  }
}
