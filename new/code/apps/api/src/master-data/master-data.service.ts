import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Department } from './entities/department.entity.js';
import { Ward } from './entities/ward.entity.js';

export interface CreateDepartmentInput {
  departmentCode: string;
  departmentName: string;
  description?: string;
  isAppointmentApplicable?: boolean;
  parentDepartmentId?: string;
  roomNumber?: string;
  noticeText?: string;
}

export interface CreateWardInput {
  wardCode: string;
  wardName: string;
  wardType?: string;
  bedCapacity?: number;
}

@Injectable()
export class MasterDataService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createDepartment(input: CreateDepartmentInput): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const existing = await repository.findOne({ where: { departmentCode: input.departmentCode } });
      if (existing) {
        throw new ConflictException(`Department code ${input.departmentCode} already exists`);
      }
      return repository.save(
        repository.create({
          departmentCode: input.departmentCode,
          departmentName: input.departmentName,
          description: input.description ?? null,
          isAppointmentApplicable: input.isAppointmentApplicable ?? false,
          parentDepartmentId: input.parentDepartmentId ?? null,
          roomNumber: input.roomNumber ?? null,
          noticeText: input.noticeText ?? null,
        }),
      );
    });
  }

  async listDepartments(): Promise<Department[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Department).find({ order: { createdAt: 'ASC' } }),
    );
  }

  async getDepartment(id: string): Promise<Department | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Department).findOne({ where: { id } }),
    );
  }

  async deactivateDepartment(id: string): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const department = await repository.findOne({ where: { id } });
      if (!department) {
        throw new NotFoundException(`Department ${id} not found`);
      }
      if (!department.isActive) {
        return department;
      }
      const activeChild = await repository.findOne({
        where: { parentDepartmentId: id, isActive: true },
      });
      if (activeChild) {
        throw new ConflictException(
          `Cannot deactivate department ${id}: it is still the parent of active department ${activeChild.id}`,
        );
      }
      department.isActive = false;
      return repository.save(department);
    });
  }

  async reactivateDepartment(id: string): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const department = await repository.findOne({ where: { id } });
      if (!department) {
        throw new NotFoundException(`Department ${id} not found`);
      }
      department.isActive = true;
      return repository.save(department);
    });
  }

  async createWard(input: CreateWardInput): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const existing = await repository.findOne({ where: { wardCode: input.wardCode } });
      if (existing) {
        throw new ConflictException(`Ward code ${input.wardCode} already exists`);
      }
      return repository.save(
        repository.create({
          wardCode: input.wardCode,
          wardName: input.wardName,
          wardType: input.wardType ?? null,
          bedCapacity: input.bedCapacity ?? null,
        }),
      );
    });
  }

  async listWards(): Promise<Ward[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Ward).find({ order: { createdAt: 'ASC' } }),
    );
  }

  async getWard(id: string): Promise<Ward | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Ward).findOne({ where: { id } }),
    );
  }

  async deactivateWard(id: string): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const ward = await repository.findOne({ where: { id } });
      if (!ward) {
        throw new NotFoundException(`Ward ${id} not found`);
      }
      if (!ward.isActive) {
        return ward;
      }
      ward.isActive = false;
      return repository.save(ward);
    });
  }

  async reactivateWard(id: string): Promise<Ward> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Ward);
      const ward = await repository.findOne({ where: { id } });
      if (!ward) {
        throw new NotFoundException(`Ward ${id} not found`);
      }
      ward.isActive = true;
      return repository.save(ward);
    });
  }
}
