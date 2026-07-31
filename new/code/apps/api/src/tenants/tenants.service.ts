import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './entities/tenant.entity.js';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

export interface ProvisionTenantInput {
  hospitalId: string;
  hospitalName: string;
  createdBy?: string;
}

@Injectable()
export class TenantsService {
  constructor(private readonly dataSource: DataSource) {}

  async provisionTenant(input: ProvisionTenantInput): Promise<Tenant> {
    if (!SAFE_HOSPITAL_ID.test(input.hospitalId)) {
      throw new BadRequestException(`Invalid hospitalId format: ${input.hospitalId}`);
    }

    const repository = this.dataSource.getRepository(Tenant);
    const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
    if (existing) {
      throw new ConflictException(`Tenant ${input.hospitalId} already exists`);
    }

    return repository.save(
      repository.create({
        hospitalId: input.hospitalId,
        hospitalName: input.hospitalName,
        status: 'active',
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: input.createdBy ?? null,
      }),
    );
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
