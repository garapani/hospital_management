import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class InventoryCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createCategory(input: CreateItemCategoryInput): Promise<InventoryItemCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InventoryItemCategory);
      const categoryData: Partial<InventoryItemCategory> = {
        name: input.name,
        displaySequence: input.displaySequence ?? 0,
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
        reorderLevel: String(input.reorderLevel ?? 0),
        minimumStock: String(input.minimumStock ?? 0),
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
