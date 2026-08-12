import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Department } from './entities/department.entity.js';
import { Ward } from './entities/ward.entity.js';
import { Bed } from './entities/bed.entity.js';
import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { DepartmentCatalog } from './entities/department-catalog.entity.js';

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

export interface CreateBedInput {
  wardId: string;
  bedNumber: string;
  bedType?: string;
}

@Injectable()
export class MasterDataService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly dataSource: DataSource,
  ) {}

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

  async createBed(input: CreateBedInput): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const ward = await manager.getRepository(Ward).findOne({ where: { id: input.wardId } });
      if (!ward) {
        throw new NotFoundException(`Ward ${input.wardId} not found`);
      }

      const repository = manager.getRepository(Bed);
      const existing = await repository.findOne({ where: { wardId: input.wardId, bedNumber: input.bedNumber } });
      if (existing) {
        throw new ConflictException(`Bed ${input.bedNumber} already exists in ward ${input.wardId}`);
      }

      return repository.save(
        repository.create({
          wardId: input.wardId,
          bedNumber: input.bedNumber,
          bedType: input.bedType ?? null,
          status: 'Available',
          isActive: true,
        }),
      );
    });
  }

  async listBedsByWard(wardId: string): Promise<Bed[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Bed).find({ where: { wardId }, order: { bedNumber: 'ASC' } }),
    );
  }

  async getBed(id: string): Promise<Bed | null> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Bed).findOne({ where: { id } }),
    );
  }

  async deactivateBed(id: string): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Bed);
      const bed = await repository.findOne({ where: { id } });
      if (!bed) {
        throw new NotFoundException(`Bed ${id} not found`);
      }
      if (bed.status === 'Occupied') {
        throw new ConflictException(`Cannot deactivate bed ${id}: it is currently occupied`);
      }
      if (!bed.isActive) {
        return bed;
      }
      bed.isActive = false;
      return repository.save(bed);
    });
  }

  async reactivateBed(id: string): Promise<Bed> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Bed);
      const bed = await repository.findOne({ where: { id } });
      if (!bed) {
        throw new NotFoundException(`Bed ${id} not found`);
      }
      bed.isActive = true;
      return repository.save(bed);
    });
  }

  async listRoles(): Promise<Role[]> {
    return this.dataSource.getRepository(Role).find({
      order: { priority: 'DESC', name: 'ASC' },
    });
  }

  async createRole(input: {
    name: string;
    description: string;
    priority: number;
    isCrossTenant?: boolean;
    bypassesPermissionChecks?: boolean;
  }): Promise<Role> {
    const repository = this.dataSource.getRepository(Role);
    const existing = await repository.findOne({ where: { name: input.name } });
    if (existing) {
      throw new ConflictException(`Role with name ${input.name} already exists`);
    }

    return repository.save(
      repository.create({
        name: input.name,
        description: input.description,
        priority: input.priority,
        isCrossTenant: input.isCrossTenant ?? false,
        bypassesPermissionChecks: input.bypassesPermissionChecks ?? false,
        isActive: true,
      }),
    );
  }

  async listDepartmentCatalogs(): Promise<DepartmentCatalog[]> {
    return this.dataSource.getRepository(DepartmentCatalog).find({
      order: { departmentName: 'ASC' }
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
      })
    );
  }
}
