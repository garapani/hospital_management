import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { LabTestCategory } from './entities/lab-test-category.entity.js';
import { LabTest } from './entities/lab-test.entity.js';
import { LabTestComponent } from './entities/lab-test-component.entity.js';

export interface CreateLabTestCategoryInput {
  name: string;
  displaySequence?: number;
}

export interface CreateLabTestInput {
  categoryId: string;
  name: string;
  code: string;
  specimenType: string;
  /** Selling price in INR; null = not priced yet. */
  price?: number;
}

export interface UpdateLabTestInput {
  name?: string;
  code?: string;
  specimenType?: string;
  /** Selling price in INR; null = not priced yet. */
  price?: number;
}

export interface CreateLabTestComponentInput {
  name: string;
  unit?: string;
  referenceRangeLow?: number;
  referenceRangeHigh?: number;
  referenceRangeText?: string;
  displaySequence?: number;
}

@Injectable()
export class LabCatalogService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createCategory(input: CreateLabTestCategoryInput): Promise<LabTestCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTestCategory);
      return repository.save(
        repository.create({
          name: input.name,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listCategories(): Promise<LabTestCategory[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LabTestCategory).find({ order: { displaySequence: 'ASC' } }),
    );
  }

  async deactivateCategory(id: string): Promise<LabTestCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTestCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Lab test category ${id} not found`);
      }
      if (!category.isActive) {
        throw new ConflictException(`Lab test category ${id} is already deactivated`);
      }
      category.isActive = false;
      return repository.save(category);
    });
  }

  async reactivateCategory(id: string): Promise<LabTestCategory> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTestCategory);
      const category = await repository.findOne({ where: { id } });
      if (!category) {
        throw new NotFoundException(`Lab test category ${id} not found`);
      }
      category.isActive = true;
      return repository.save(category);
    });
  }

  async createTest(input: CreateLabTestInput): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const category = await manager
        .getRepository(LabTestCategory)
        .findOne({ where: { id: input.categoryId } });
      if (!category) {
        throw new NotFoundException(`Lab test category ${input.categoryId} not found`);
      }

      const repository = manager.getRepository(LabTest);
      return repository.save(
        repository.create({
          categoryId: input.categoryId,
          name: input.name,
          code: input.code,
          specimenType: input.specimenType,
          price: input.price ?? null,
        }),
      );
    });
  }

  async updateTestPrice(id: string, price: number): Promise<LabTest> {
    if (!Number.isFinite(price) || price < 0) {
      throw new BadRequestException('Price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTest);
      const test = await repository.findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      test.price = price;
      return repository.save(test);
    });
  }

  async updateTest(id: string, input: UpdateLabTestInput): Promise<LabTest> {
    if (input.price !== undefined && (!Number.isFinite(input.price) || input.price < 0)) {
      throw new BadRequestException('Price must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTest);
      const test = await repository.findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      if (input.name !== undefined) {
        test.name = input.name;
      }
      if (input.code !== undefined) {
        test.code = input.code;
      }
      if (input.specimenType !== undefined) {
        test.specimenType = input.specimenType;
      }
      if (input.price !== undefined) {
        test.price = input.price;
      }
      return repository.save(test);
    });
  }

  async deactivateTest(id: string): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTest);
      const test = await repository.findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      if (!test.isActive) {
        throw new ConflictException(`Lab test ${id} is already deactivated`);
      }
      test.isActive = false;
      return repository.save(test);
    });
  }

  async reactivateTest(id: string): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(LabTest);
      const test = await repository.findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      test.isActive = true;
      return repository.save(test);
    });
  }

  async listTestsByCategory(categoryId: string): Promise<LabTest[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(LabTest).find({ where: { categoryId }, order: { name: 'ASC' } }),
    );
  }

  async getTest(id: string): Promise<LabTest> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const test = await manager.getRepository(LabTest).findOne({ where: { id } });
      if (!test) {
        throw new NotFoundException(`Lab test ${id} not found`);
      }
      return test;
    });
  }

  async createComponent(testId: string, input: CreateLabTestComponentInput): Promise<LabTestComponent> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const test = await manager.getRepository(LabTest).findOne({ where: { id: testId } });
      if (!test) {
        throw new NotFoundException(`Lab test ${testId} not found`);
      }

      const repository = manager.getRepository(LabTestComponent);
      return repository.save(
        repository.create({
          testId,
          name: input.name,
          unit: input.unit ?? null,
          referenceRangeLow: input.referenceRangeLow != null ? String(input.referenceRangeLow) : null,
          referenceRangeHigh: input.referenceRangeHigh != null ? String(input.referenceRangeHigh) : null,
          referenceRangeText: input.referenceRangeText ?? null,
          displaySequence: input.displaySequence ?? 0,
        }),
      );
    });
  }

  async listComponentsByTest(testId: string): Promise<LabTestComponent[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager
        .getRepository(LabTestComponent)
        .find({ where: { testId }, order: { displaySequence: 'ASC' } }),
    );
  }
}
