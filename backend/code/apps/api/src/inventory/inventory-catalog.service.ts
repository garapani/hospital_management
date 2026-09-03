import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { In, QueryFailedError } from 'typeorm';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { InventoryItemCategory } from './entities/inventory-item-category.entity.js';
import { InventoryItemSubCategory } from './entities/inventory-item-sub-category.entity.js';
import { InventoryItem } from './entities/inventory-item.entity.js';
import { InventoryVendor } from './entities/inventory-vendor.entity.js';

export interface CreateItemCategoryInput {
  name: string;
  displaySequence?: number;
}

export interface CreateItemSubCategoryInput {
  categoryId: string;
  name: string;
  isConsumable?: boolean;
}

export interface CreateItemInput {
  subCategoryId: string;
  name: string;
  code: string;
  unitOfMeasure: string;
  reorderLevel?: number;
  minimumStock?: number;
  /** Selling price in INR (e.g. a drug's retail price); null = not priced yet. */
  salePrice?: number;
}

export interface CreateVendorInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

export interface UpdateItemInput {
  name?: string;
  code?: string;
  unitOfMeasure?: string;
  reorderLevel?: number;
  minimumStock?: number;
  /** Selling price in INR (e.g. a drug's retail price); null = not priced yet. */
  salePrice?: number;
}

/**
 * Coerces and range-validates an optional numeric field. Rejects anything `Number()` would
 * otherwise silently coerce (booleans, arrays, empty strings) via the `typeof` check, and rejects
 * non-finite values (`NaN`, `Infinity`) via `Number.isFinite`. Returns the field's default when
 * the input is `undefined`.
 */
function coerceOptionalNonNegativeNumber(value: number | undefined, fieldName: string, defaultValue = 0): number {
  if (value === undefined) {
    return defaultValue;
  }
  const coerced = Number(value);
  if (typeof value !== 'number' || !Number.isFinite(coerced) || coerced < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative number`);
  }
  return coerced;
}

@Injectable()
export class InventoryCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createCategory(input: CreateItemCategoryInput): Promise<InventoryItemCategory> {
    const displaySequence = coerceOptionalNonNegativeNumber(input.displaySequence, 'displaySequence');
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemCategory);
      const categoryData: Partial<InventoryItemCategory> = {
        name: input.name,
        displaySequence,
      };
      return repository.save(repository.create(categoryData));
    });
  }

  async listCategories(): Promise<InventoryItemCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItemCategory).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async deactivateCategory(id: string): Promise<InventoryItemCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Inventory item category ${id} not found`);
      }
      if (!category.isActive) {
        throw new ConflictException(`Inventory item category ${id} is already deactivated`);
      }
      category.isActive = false;
      return repository.save(category);
    });
  }

  async reactivateCategory(id: string): Promise<InventoryItemCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Inventory item category ${id} not found`);
      }
      category.isActive = true;
      return repository.save(category);
    });
  }

  async createSubCategory(input: CreateItemSubCategoryInput): Promise<InventoryItemSubCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const category = await manager
        .getRepository(InventoryItemCategory)
        .findOne({ where: { id: input.categoryId } });
      if (!category) {
        throw new NotFoundException(`Inventory item category ${input.categoryId} not found`);
      }

      const repository = manager.getRepository(InventoryItemSubCategory);
      const subCategoryData: Partial<InventoryItemSubCategory> = {
        categoryId: input.categoryId,
        name: input.name,
        isConsumable: input.isConsumable ?? false,
      };
      return repository.save(repository.create(subCategoryData));
    });
  }

  async listSubCategoriesByCategory(
    categoryId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<InventoryItemSubCategory>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager
        .createQueryBuilder(InventoryItemSubCategory, 'sc')
        .where('sc.categoryId = :categoryId', { categoryId });
      return paginate(qb, query);
    });
  }

  async deactivateSubCategory(id: string): Promise<InventoryItemSubCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemSubCategory);
      const subCategory = await repository.findOne({ where: { id } });
      if (!subCategory) {
        throw new NotFoundException(`Inventory item sub-category ${id} not found`);
      }
      if (!subCategory.isActive) {
        throw new ConflictException(`Inventory item sub-category ${id} is already deactivated`);
      }
      subCategory.isActive = false;
      return repository.save(subCategory);
    });
  }

  async reactivateSubCategory(id: string): Promise<InventoryItemSubCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemSubCategory);
      const subCategory = await repository.findOne({ where: { id } });
      if (!subCategory) {
        throw new NotFoundException(`Inventory item sub-category ${id} not found`);
      }
      subCategory.isActive = true;
      return repository.save(subCategory);
    });
  }

  async createItem(input: CreateItemInput): Promise<InventoryItem> {
    const reorderLevel = coerceOptionalNonNegativeNumber(input.reorderLevel, 'reorderLevel');
    const minimumStock = coerceOptionalNonNegativeNumber(input.minimumStock, 'minimumStock');
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const subCategory = await manager
        .getRepository(InventoryItemSubCategory)
        .findOne({ where: { id: input.subCategoryId } });
      if (!subCategory) {
        throw new NotFoundException(`Inventory item sub-category ${input.subCategoryId} not found`);
      }

      const repository = manager.getRepository(InventoryItem);
      const itemData: Partial<InventoryItem> = {
        subCategoryId: input.subCategoryId,
        name: input.name,
        code: input.code,
        unitOfMeasure: input.unitOfMeasure,
        reorderLevel: String(reorderLevel),
        minimumStock: String(minimumStock),
        salePrice: input.salePrice ?? null,
      };
      try {
        return await repository.save(repository.create(itemData));
      } catch (error) {
        throw this.mapCodeConflict(error, input.code);
      }
    });
  }

  /** Maps a `UQ_inventory_items_code` violation to a 409 (code-review-findings-2026-08-25 inventory
   *  P2), same shape as the lab_tests code-uniqueness fix. Rethrows anything else unchanged. */
  private mapCodeConflict(error: unknown, code: string): unknown {
    if (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { constraint?: string }).constraint === 'UQ_inventory_items_code'
    ) {
      return new ConflictException(`Inventory item code ${code} is already in use`);
    }
    return error;
  }

  async updateItemSalePrice(id: string, salePrice: number): Promise<InventoryItem> {
    if (!Number.isFinite(salePrice) || salePrice < 0) {
      throw new BadRequestException('Sale price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      item.salePrice = salePrice;
      return repository.save(item);
    });
  }

  async updateItem(id: string, input: UpdateItemInput): Promise<InventoryItem> {
    const reorderLevel =
      input.reorderLevel !== undefined ? coerceOptionalNonNegativeNumber(input.reorderLevel, 'reorderLevel') : undefined;
    const minimumStock =
      input.minimumStock !== undefined ? coerceOptionalNonNegativeNumber(input.minimumStock, 'minimumStock') : undefined;
    if (input.salePrice !== undefined && (!Number.isFinite(input.salePrice) || input.salePrice < 0)) {
      throw new BadRequestException('Sale price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      if (input.name !== undefined) {
        item.name = input.name;
      }
      if (input.code !== undefined) {
        item.code = input.code;
      }
      if (input.unitOfMeasure !== undefined) {
        item.unitOfMeasure = input.unitOfMeasure;
      }
      if (reorderLevel !== undefined) {
        item.reorderLevel = String(reorderLevel);
      }
      if (minimumStock !== undefined) {
        item.minimumStock = String(minimumStock);
      }
      if (input.salePrice !== undefined) {
        item.salePrice = input.salePrice;
      }
      try {
        return await repository.save(item);
      } catch (error) {
        throw this.mapCodeConflict(error, item.code);
      }
    });
  }

  async deactivateItem(id: string): Promise<InventoryItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      if (!item.isActive) {
        throw new ConflictException(`Inventory item ${id} is already deactivated`);
      }
      item.isActive = false;
      return repository.save(item);
    });
  }

  async reactivateItem(id: string): Promise<InventoryItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      item.isActive = true;
      return repository.save(item);
    });
  }

  async listItemsBySubCategory(
    subCategoryId: string,
    query: PaginationQueryDto,
  ): Promise<PaginatedResponseDto<InventoryItem>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager
        .createQueryBuilder(InventoryItem, 'i')
        .where('i.subCategoryId = :subCategoryId', { subCategoryId });
      return paginate(qb, query);
    });
  }

  async getItem(id: string): Promise<InventoryItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.getRepository(InventoryItem).findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Inventory item ${id} not found`);
      }
      return item;
    });
  }

  /**
   * Batched existence check for multiple item ids in a single query/transaction, rather than one
   * `getItem` call (and one `runInTenantSchema` transaction) per id. Throws `NotFoundException`
   * naming every requested id that doesn't exist.
   */
  async getItemsByIds(ids: string[]): Promise<InventoryItem[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const items = await manager.getRepository(InventoryItem).findBy({ id: In(ids) });
      const foundIds = new Set(items.map((item) => item.id));
      const missingIds = ids.filter((id) => !foundIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundException(`Inventory item(s) not found: ${missingIds.join(', ')}`);
      }
      return items;
    });
  }

  async createVendor(input: CreateVendorInput): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryVendor);
      const vendorData: Partial<InventoryVendor> = {
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      };
      return repository.save(repository.create(vendorData));
    });
  }

  async listVendors(query: PaginationQueryDto): Promise<PaginatedResponseDto<InventoryVendor>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager
        .createQueryBuilder(InventoryVendor, 'v')
        .orderBy('v.name', 'ASC');
      return paginate(qb, query);
    });
  }

  async getVendor(id: string): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const vendor = await manager.getRepository(InventoryVendor).findOne({ where: { id } });
      if (!vendor) {
        throw new NotFoundException(`Inventory vendor ${id} not found`);
      }
      return vendor;
    });
  }

  async deactivateVendor(id: string): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryVendor);
      const vendor = await repository.findOne({ where: { id } });
      if (!vendor) {
        throw new NotFoundException(`Inventory vendor ${id} not found`);
      }
      if (!vendor.isActive) {
        throw new ConflictException(`Inventory vendor ${id} is already deactivated`);
      }
      vendor.isActive = false;
      return repository.save(vendor);
    });
  }

  async reactivateVendor(id: string): Promise<InventoryVendor> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryVendor);
      const vendor = await repository.findOne({ where: { id } });
      if (!vendor) {
        throw new NotFoundException(`Inventory vendor ${id} not found`);
      }
      vendor.isActive = true;
      return repository.save(vendor);
    });
  }
}
