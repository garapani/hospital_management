import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DepartmentCatalog } from './entities/department-catalog.entity.js';

@Injectable()
export class DepartmentCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async listDepartmentCatalogs(): Promise<DepartmentCatalog[]> {
    // The catalog screen shows every entry (including inactive ones, so they can be re-activated).
    return this.dataSource.getRepository(DepartmentCatalog).find({
      order: { departmentName: 'ASC' },
    });
  }

  async createDepartmentCatalog(input: {
    departmentCode: string;
    departmentName: string;
    description: string | null;
    isAppointmentApplicable: boolean;
  }): Promise<DepartmentCatalog> {
    const repository = this.dataSource.getRepository(DepartmentCatalog);
    const existing = await repository.findOne({ where: { departmentCode: input.departmentCode } });
    if (existing) {
      throw new ConflictException(`Catalog Department code ${input.departmentCode} already exists`);
    }

    return repository.save(
      repository.create({
        departmentCode: input.departmentCode,
        departmentName: input.departmentName,
        description: input.description,
        isAppointmentApplicable: input.isAppointmentApplicable,
        isActive: true,
      }),
    );
  }

  /** Edits catalog metadata. The code is immutable — it is the stable identifier tenants
   *  reference when picking catalog departments. */
  async updateDepartmentCatalog(
    id: string,
    input: { departmentName?: string; description?: string | null; isAppointmentApplicable?: boolean },
  ): Promise<DepartmentCatalog> {
    const repository = this.dataSource.getRepository(DepartmentCatalog);
    const catalog = await repository.findOne({ where: { id } });
    if (!catalog) {
      throw new NotFoundException(`Catalog department ${id} not found`);
    }
    if (input.departmentName !== undefined) catalog.departmentName = input.departmentName;
    if (input.description !== undefined) catalog.description = input.description;
    if (input.isAppointmentApplicable !== undefined) {
      catalog.isAppointmentApplicable = input.isAppointmentApplicable;
    }
    return repository.save(catalog);
  }

  async deactivateDepartmentCatalog(id: string): Promise<DepartmentCatalog> {
    const repository = this.dataSource.getRepository(DepartmentCatalog);
    const catalog = await repository.findOne({ where: { id } });
    if (!catalog) {
      throw new NotFoundException(`Catalog department ${id} not found`);
    }
    catalog.isActive = false;
    return repository.save(catalog);
  }

  async reactivateDepartmentCatalog(id: string): Promise<DepartmentCatalog> {
    const repository = this.dataSource.getRepository(DepartmentCatalog);
    const catalog = await repository.findOne({ where: { id } });
    if (!catalog) {
      throw new NotFoundException(`Catalog department ${id} not found`);
    }
    catalog.isActive = true;
    return repository.save(catalog);
  }
}
