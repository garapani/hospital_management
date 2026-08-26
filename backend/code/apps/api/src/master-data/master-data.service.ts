import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { Department } from './entities/department.entity.js';
import { Ward } from './entities/ward.entity.js';
import { Bed } from './entities/bed.entity.js';

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
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async createDepartment(input: CreateDepartmentInput): Promise<Department> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Department);
      const existing = await repository.findOne({ where: { departmentCode: input.departmentCode } });
      if (existing) {
        throw new ConflictException(`Department code ${input.departmentCode} already exists`);
      }
      try {
        return await repository.save(
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
      } catch (error) {
        // Race-safety backstop for the pre-check above (departmentCode is unique) — a concurrent
        // duplicate must 409, not 500 (code-review-findings-2026-08-25 master-data P3).
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint === 'departments_departmentCode_key'
        ) {
          throw new ConflictException(`Department code ${input.departmentCode} already exists`);
        }
        throw error;
      }
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
      // Reactivating a child under a deactivated parent would leave an active department
      // hanging off an inactive tree — the mirror of deactivate's child-check
      // (code-review-findings-2026-08-25 master-data P3).
      if (department.parentDepartmentId) {
        const parent = await repository.findOne({ where: { id: department.parentDepartmentId } });
        if (parent && !parent.isActive) {
          throw new ConflictException(
            `Cannot reactivate department ${id}: its parent ${department.parentDepartmentId} is deactivated`,
          );
        }
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
      try {
        return await repository.save(
          repository.create({
            wardCode: input.wardCode,
            wardName: input.wardName,
            wardType: input.wardType ?? null,
            bedCapacity: input.bedCapacity ?? null,
          }),
        );
      } catch (error) {
        // Race-safety backstop for the pre-check above (wardCode is unique) — a concurrent
        // duplicate must 409, not 500 (code-review-findings-2026-08-25 master-data P3).
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint === 'wards_wardCode_key'
        ) {
          throw new ConflictException(`Ward code ${input.wardCode} already exists`);
        }
        throw error;
      }
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
      // A ward with occupied beds can't be deactivated — mirror of deactivateBed's occupied
      // guard (code-review-findings-2026-08-25 master-data P3).
      const occupiedBed = await manager.getRepository(Bed).findOne({
        where: { wardId: id, status: 'Occupied' },
      });
      if (occupiedBed) {
        throw new ConflictException(
          `Cannot deactivate ward ${id}: it has an occupied bed (${occupiedBed.id})`,
        );
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

      try {
        return await repository.save(
          repository.create({
            wardId: input.wardId,
            bedNumber: input.bedNumber,
            bedType: input.bedType ?? null,
            status: 'Available',
            isActive: true,
          }),
        );
      } catch (error) {
        // Race-safety backstop for the pre-check above (UQ_beds_ward_bed_number) — a concurrent
        // duplicate must 409, not 500 (code-review-findings-2026-08-25 master-data P3).
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint === 'UQ_beds_ward_bed_number'
        ) {
          throw new ConflictException(`Bed ${input.bedNumber} already exists in ward ${input.wardId}`);
        }
        throw error;
      }
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
}
