import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { Tenant } from './entities/tenant.entity.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { Role } from '../rbac/entities/role.entity.js';
import { DepartmentCatalog } from '../master-data/entities/department-catalog.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

export interface ProvisionTenantInput {
  hospitalId: string;
  hospitalName: string;
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async provisionTenant(input: ProvisionTenantInput): Promise<Tenant> {
    if (!SAFE_HOSPITAL_ID.test(input.hospitalId)) {
      throw new BadRequestException(`Invalid hospitalId format: ${input.hospitalId}`);
    }

    const repository = this.dataSource.getRepository(Tenant);
    const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
    if (existing) {
      throw new ConflictException(`Tenant ${input.hospitalId} already exists`);
    }

    // Schema/role/migrations before the registry row: if provisioning fails partway through, no
    // registry row exists to make the tenant look ready when it isn't.
    await this.tenantProvisioning.provisionTenantSchema(input.hospitalId);

    let roles: Role[] = [];
    if (input.roleIds && input.roleIds.length > 0) {
      roles = await this.dataSource.getRepository(Role)
        .createQueryBuilder('role')
        .where('role.id IN (:...ids)', { ids: input.roleIds })
        .getMany();
    }

    const tenant = await repository.save(
      repository.create({
        hospitalId: input.hospitalId,
        hospitalName: input.hospitalName,
        status: 'active',
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: input.createdBy ?? null,
        roles,
      }),
    );

    // Seed local departments
    if (input.departmentCatalogIds && input.departmentCatalogIds.length > 0) {
      const catalogs = await this.dataSource.getRepository(DepartmentCatalog)
        .createQueryBuilder('catalog')
        .where('catalog.id IN (:...ids)', { ids: input.departmentCatalogIds })
        .getMany();
      
      if (catalogs.length > 0) {
        // provisionTenant runs outside any per-request tenant context (it's what CREATES the
        // tenant), so runInTenantSchema has no ambient schema to resolve — establish one for
        // just this seeding call via TenantContextService.run(), the same pattern the test
        // helper's inTenant() uses.
        await this.tenantContext.run(
          { tenantId: input.hospitalId, correlationId: 'tenant-provisioning' },
          () =>
            this.tenantConnection.runInTenantSchema(async (manager) => {
              const deptRepo = manager.getRepository(Department);
              const depts = catalogs.map((c) =>
                deptRepo.create({
                  departmentCode: c.departmentCode,
                  departmentName: c.departmentName,
                  description: c.description,
                  isAppointmentApplicable: c.isAppointmentApplicable,
                  isActive: c.isActive,
                }),
              );
              await deptRepo.save(depts);
            }),
        );
      }
    }

    return tenant;
  }

  async listTenants(): Promise<Tenant[]> {
    return this.dataSource.getRepository(Tenant).find({ order: { createdAt: 'ASC' } });
  }

  async getTenant(hospitalId: string): Promise<Tenant | null> {
    return this.dataSource.getRepository(Tenant).findOne({ where: { hospitalId } });
  }

  async suspendTenant(hospitalId: string): Promise<Tenant> {
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'suspended') {
      return tenant;
    }
    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    return repository.save(tenant);
  }

  async reactivateTenant(hospitalId: string): Promise<Tenant> {
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'active') {
      return tenant;
    }
    tenant.status = 'active';
    tenant.activatedAt = new Date();
    return repository.save(tenant);
  }
}
