import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In } from 'typeorm';
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
}

export interface CreateVendorInput {
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
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

  async listSubCategoriesByCategory(categoryId: string): Promise<InventoryItemSubCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItemSubCategory).find({ where: { categoryId } }),
    );
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
      };
      return repository.save(repository.create(itemData));
    });
  }

  async listItemsBySubCategory(subCategoryId: string): Promise<InventoryItem[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryItem).find({ where: { subCategoryId } }),
    );
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

  async listVendors(): Promise<InventoryVendor[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InventoryVendor).find({ order: { name: 'ASC' } }),
    );
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
}
