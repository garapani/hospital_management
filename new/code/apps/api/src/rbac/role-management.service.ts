import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Role } from './entities/role.entity.js';

@Injectable()
export class RoleManagementService {
  constructor(private readonly dataSource: DataSource) {}

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
}
