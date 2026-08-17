import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DepartmentCatalog } from './entities/department-catalog.entity.js';

@Injectable()
export class DepartmentCatalogService {
  constructor(private readonly dataSource: DataSource) {}

  async listDepartmentCatalogs(): Promise<DepartmentCatalog[]> {
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
}
