import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { RadiologyImagingType } from './entities/radiology-imaging-type.entity.js';
import { RadiologyImagingItem } from './entities/radiology-imaging-item.entity.js';

export interface CreateImagingTypeInput {
  name: string;
  procedureCoding?: string;
  displaySequence?: number;
}

export interface CreateImagingItemInput {
  imagingTypeId: string;
  name: string;
  procedureCode?: string;
  displaySequence?: number;
  /** Selling price in INR; null = not priced yet. */
  price?: number;
}

export interface UpdateImagingItemInput {
  name?: string;
  procedureCode?: string;
  displaySequence?: number;
  /** Selling price in INR; null = not priced yet. */
  price?: number;
}

@Injectable()
export class RadiologyCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createType(input: CreateImagingTypeInput): Promise<RadiologyImagingType> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingType);
      return repository.save(
        repository.create({
          name: input.name,
          procedureCoding: input.procedureCoding ?? null,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listTypes(): Promise<RadiologyImagingType[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(RadiologyImagingType).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async deactivateType(id: string): Promise<RadiologyImagingType> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingType);
      const type = await repository.findOne({ where: { id } });
      if (!type) {
        throw new NotFoundException(`Radiology imaging type ${id} not found`);
      }
      if (!type.isActive) {
        throw new ConflictException(`Radiology imaging type ${id} is already deactivated`);
      }
      type.isActive = false;
      return repository.save(type);
    });
  }

  async reactivateType(id: string): Promise<RadiologyImagingType> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingType);
      const type = await repository.findOne({ where: { id } });
      if (!type) {
        throw new NotFoundException(`Radiology imaging type ${id} not found`);
      }
      type.isActive = true;
      return repository.save(type);
    });
  }

  async createItem(input: CreateImagingItemInput): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const type = await manager
        .getRepository(RadiologyImagingType)
        .findOne({ where: { id: input.imagingTypeId } });
      if (!type) {
        throw new NotFoundException(`Radiology imaging type ${input.imagingTypeId} not found`);
      }

      const repository = manager.getRepository(RadiologyImagingItem);
      return repository.save(
        repository.create({
          imagingTypeId: input.imagingTypeId,
          name: input.name,
          procedureCode: input.procedureCode ?? null,
          displaySequence: input.displaySequence ?? 0,
          price: input.price ?? null,
        }),
      );
    });
  }

  async updateItemPrice(id: string, price: number): Promise<RadiologyImagingItem> {
    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException('Price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      item.price = price;
      return repository.save(item);
    });
  }

  async updateItem(id: string, input: UpdateImagingItemInput): Promise<RadiologyImagingItem> {
    if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
      throw new BadRequestException('Price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      if (input.name !== undefined) {
        item.name = input.name;
      }
      if (input.procedureCode !== undefined) {
        item.procedureCode = input.procedureCode;
      }
      if (input.displaySequence !== undefined) {
        item.displaySequence = input.displaySequence;
      }
      if (input.price !== undefined) {
        item.price = input.price;
      }
      return repository.save(item);
    });
  }

  async deactivateItem(id: string): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      if (!item.isActive) {
        throw new ConflictException(`Radiology imaging item ${id} is already deactivated`);
      }
      item.isActive = false;
      return repository.save(item);
    });
  }

  async reactivateItem(id: string): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(RadiologyImagingItem);
      const item = await repository.findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      item.isActive = true;
      return repository.save(item);
    });
  }

  async listItemsByType(imagingTypeId: string): Promise<RadiologyImagingItem[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(RadiologyImagingItem)
        .find({ where: { imagingTypeId }, order: { displaySequence: 'ASC' } }),
    );
  }

  async getItem(id: string): Promise<RadiologyImagingItem> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const item = await manager.getRepository(RadiologyImagingItem).findOne({ where: { id } });
      if (!item) {
        throw new NotFoundException(`Radiology imaging item ${id} not found`);
      }
      return item;
    });
  }
}
