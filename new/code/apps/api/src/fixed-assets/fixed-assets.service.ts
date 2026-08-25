import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { FixedAssetNumberGeneratorService } from './fixed-asset-number-generator.service.js';
import { FixedAsset, FixedAssetCondition, FIXED_ASSET_CONDITIONS } from './entities/fixed-asset.entity.js';
import { FixedAssetCategory } from './entities/fixed-asset-category.entity.js';
import { AssetDepreciationEntry } from './entities/asset-depreciation-entry.entity.js';
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

export interface ListDepreciationEntriesQuery extends PaginationQueryDto {
  assetId?: string;
  month?: number;
  year?: number;
}

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly assetNumberGenerator: FixedAssetNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** `accruedBy` derives from the authenticated principal (see §25) — money-relevant, like
   *  payroll's processedBy. */
  private resolveActor(): string {
    return this.tenantContext.getAccountId() as string;
  }

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

  /**
   * Runs the depreciation accrual for one period: for every active, non-Retired asset with a
   * usefulLifeYears set, persists a period charge derived from computeStraightLineValuation's
   * accumulated-as-of-period-end figure minus whatever was accumulated as of its most recent
   * prior entry (0 if this is the asset's first entry) — so an out-of-order or skipped-period
   * catch-up run still charges exactly the right amount rather than assuming monthly cadence.
   * Re-runs are idempotent — an asset that already has an entry for (month, year) is skipped
   * rather than failing the whole run. Returns the entries created by this run.
   */
  async runDepreciationAccrual(month: number, year: number): Promise<AssetDepreciationEntry[]> {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('month must be an integer between 1 and 12');
    }
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      throw new BadRequestException('year must be an integer between 1900 and 9999');
    }
    const accruedBy = this.resolveActor();
    // First-of-next-month: computeStraightLineValuation's monthsInService counts full elapsed
    // calendar months up to `asOf`, so this asOf yields "accumulated through the end of `month`".
    const periodEnd = new Date(year, month, 1);

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const assets: FixedAsset[] = await manager.query(
        `SELECT * FROM fixed_assets WHERE "isActive" = true AND condition != 'Retired' AND "usefulLifeYears" IS NOT NULL`,
      );
      const repository = manager.getRepository(AssetDepreciationEntry);
      const created: AssetDepreciationEntry[] = [];
      for (const asset of assets) {
        const existing = await repository.findOne({
          where: { assetId: asset.id, periodMonth: month, periodYear: year },
        });
        if (existing) {
          continue;
        }
        const priorEntry = await repository.findOne({
          where: { assetId: asset.id },
          order: { periodYear: 'DESC', periodMonth: 'DESC' },
        });
        const valuation = computeStraightLineValuation(
          {
            purchaseDate: asset.purchaseDate,
            purchaseCost: Number(asset.purchaseCost),
            usefulLifeYears: asset.usefulLifeYears === null ? null : Number(asset.usefulLifeYears),
            salvageValue: Number(asset.salvageValue),
          },
          periodEnd,
        );
        const priorAccumulated = priorEntry?.accumulatedDepreciation ?? 0;
        const depreciationAmount = roundMoney(
          Math.max(0, valuation.accumulatedDepreciation - priorAccumulated),
        );
        created.push(
          await repository.save(
            repository.create({
              assetId: asset.id,
              periodMonth: month,
              periodYear: year,
              depreciationAmount,
              accumulatedDepreciation: valuation.accumulatedDepreciation,
              bookValue: valuation.bookValue,
              accruedBy,
            }),
          ),
        );
      }
      return created;
    });
  }

  async listDepreciationEntries(
    query: ListDepreciationEntriesQuery,
  ): Promise<PaginatedResponseDto<AssetDepreciationEntry>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(AssetDepreciationEntry).createQueryBuilder('entry');
      if (query.assetId) {
        qb.andWhere('entry.assetId = :assetId', { assetId: query.assetId });
      }
      if (query.month !== undefined) {
        qb.andWhere('entry.periodMonth = :month', { month: query.month });
      }
      if (query.year !== undefined) {
        qb.andWhere('entry.periodYear = :year', { year: query.year });
      }
      qb.orderBy('entry.createdAt', 'DESC');
      return paginate(qb, query);
    });
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
