import { Injectable, NotFoundException } from '@nestjs/common';
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
        }),
      );
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
