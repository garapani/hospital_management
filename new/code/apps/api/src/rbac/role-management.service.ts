import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Role } from './entities/role.entity.js';

@Injectable()
export class RoleManagementService {
  constructor(private readonly dataSource: DataSource) {}

  async listRoles(): Promise<Role[]> {
    // The catalog screen shows every role (including deactivated ones, so they can be
    // re-activated); pickers filter via AccountsService.listRoles instead.
    return this.dataSource.getRepository(Role).find({
      order: { priority: 'DESC', name: 'ASC' },
    });
  }

  async createRole(input: {
    name: string;
    description: string;
    priority: number;
    isCrossTenant?: boolean;
  }): Promise<Role> {
    const repository = this.dataSource.getRepository(Role);
    const existing = await repository.findOne({ where: { name: input.name } });
    if (existing) {
      throw new ConflictException(`Role with name ${input.name} already exists`);
    }

    try {
      return await repository.save(
        repository.create({
          name: input.name,
          description: input.description,
          priority: input.priority,
          isCrossTenant: input.isCrossTenant ?? false,
          isActive: true,
        }),
      );
    } catch (error) {
      // Race-safety backstop for the pre-check above (roles.name is unique via the inline
      // `name varchar NOT NULL UNIQUE`, auto-named roles_name_key) — a concurrent duplicate
      // must 409, not 500 (code-review-findings-2026-08-25 rbac P3).
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { constraint?: string }).constraint === 'roles_name_key'
      ) {
        throw new ConflictException(`Role with name ${input.name} already exists`);
      }
      throw error;
    }
  }

  /** Edits catalog metadata. The name is immutable — renaming would orphan tenant_roles and
   *  account-role references and break role annotations everywhere. */
  async updateRole(id: string, input: { description?: string; priority?: number }): Promise<Role> {
    const repository = this.dataSource.getRepository(Role);
    const role = await repository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    if (input.description !== undefined) role.description = input.description;
    if (input.priority !== undefined) role.priority = input.priority;
    return repository.save(role);
  }

  /** Soft-removes a role from the catalog: pickers and new assignments stop offering it, but
   *  existing account assignments keep working until revoked. Cross-tenant roles (Super Admin)
   *  can never be deactivated — they are the platform's own. */
  async deactivateRole(id: string): Promise<Role> {
    const repository = this.dataSource.getRepository(Role);
    const role = await repository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    if (role.isCrossTenant) {
      throw new BadRequestException(
        `Role ${role.name} is a platform role and cannot be deactivated`,
      );
    }
    role.isActive = false;
    return repository.save(role);
  }

  async reactivateRole(id: string): Promise<Role> {
    const repository = this.dataSource.getRepository(Role);
    const role = await repository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role ${id} not found`);
    }
    role.isActive = true;
    return repository.save(role);
  }
}
