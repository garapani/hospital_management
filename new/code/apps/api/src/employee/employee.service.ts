import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { Employee, EmploymentType } from './entities/employee.entity.js';
import { EmployeeNumberGeneratorService } from './employee-number-generator.service.js';

export const EMPLOYMENT_TYPES: EmploymentType[] = ['FullTime', 'PartTime', 'Contract'];

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  departmentId?: string;
  designation?: string;
  phone?: string;
  email?: string;
  joinDate: string;
  employmentType?: EmploymentType;
  monthlyBasicSalary?: number;
  /** Deprecated — routed through resolveActor (§25); the Employee entity has no actor column, so the resolved value is not persisted. */
  createdBy?: string;
}

export interface UpdateEmployeeInput {
  firstName?: string;
  lastName?: string;
  departmentId?: string;
  designation?: string;
  phone?: string;
  email?: string;
  joinDate?: string;
  employmentType?: EmploymentType;
  monthlyBasicSalary?: number;
}

export interface ListEmployeesQuery extends PaginationQueryDto {
  departmentId?: string;
  employmentType?: EmploymentType;
  q?: string;
}

@Injectable()
export class EmployeeService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly numberGenerator: EmployeeNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields derive from the authenticated principal (see Development-Standards.md §25). The
   * Employee master has no actor column today, so the resolved value only guards the deprecated
   * `createdBy` fallback and keeps non-HTTP callers (specs/CLI) working unchanged.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async createEmployee(input: CreateEmployeeInput): Promise<Employee> {
    this.validateEmployeeInput(input, { requireNameAndDate: true });

    // §25: the authenticated principal wins over any caller-supplied value; intentionally not
    // persisted because the Employee entity has no actor column.
    this.resolveActor(input.createdBy);

    const employeeCode = await this.numberGenerator.generateNextEmployeeCode();

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      if (input.departmentId) {
        const department = await manager.query(`SELECT id FROM departments WHERE id = $1`, [
          input.departmentId,
        ]);
        if (department.length === 0) {
          throw new NotFoundException(`Department ${input.departmentId} not found`);
        }
      }

      return manager.getRepository(Employee).save(
        manager.getRepository(Employee).create({
          employeeCode,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          departmentId: input.departmentId ?? null,
          designation: input.designation ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          joinDate: input.joinDate,
          employmentType: input.employmentType ?? 'FullTime',
          monthlyBasicSalary: input.monthlyBasicSalary ?? 0,
        }),
      );
    });
  }

  async listEmployees(query: ListEmployeesQuery): Promise<PaginatedResponseDto<Employee>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(Employee).createQueryBuilder('emp');
      if (query.departmentId) {
        qb.andWhere('emp.departmentId = :departmentId', { departmentId: query.departmentId });
      }
      if (query.employmentType) {
        qb.andWhere('emp.employmentType = :employmentType', {
          employmentType: query.employmentType,
        });
      }
      if (query.q?.trim()) {
        const q = `%${query.q.trim()}%`;
        qb.andWhere(
          '(emp.firstName ILIKE :q OR emp.lastName ILIKE :q OR emp.phone ILIKE :q OR emp.email ILIKE :q)',
          { q },
        );
      }
      qb.orderBy('emp.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getEmployee(id: string): Promise<Employee> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const employee = await manager.getRepository(Employee).findOne({ where: { id } });
      if (!employee) {
        throw new NotFoundException(`Employee ${id} not found`);
      }
      return employee;
    });
  }

  async updateEmployee(id: string, input: UpdateEmployeeInput): Promise<Employee> {
    this.validateEmployeeInput(input, { requireNameAndDate: false });
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Employee);
      const employee = await repository.findOne({ where: { id } });
      if (!employee) {
        throw new NotFoundException(`Employee ${id} not found`);
      }
      if (input.departmentId) {
        const department = await manager.query(`SELECT id FROM departments WHERE id = $1`, [
          input.departmentId,
        ]);
        if (department.length === 0) {
          throw new NotFoundException(`Department ${input.departmentId} not found`);
        }
      }

      if (input.firstName !== undefined) employee.firstName = input.firstName.trim();
      if (input.lastName !== undefined) employee.lastName = input.lastName.trim();
      if (input.departmentId !== undefined) employee.departmentId = input.departmentId;
      if (input.designation !== undefined) employee.designation = input.designation;
      if (input.phone !== undefined) employee.phone = input.phone;
      if (input.email !== undefined) employee.email = input.email;
      if (input.joinDate !== undefined) employee.joinDate = input.joinDate;
      if (input.employmentType !== undefined) employee.employmentType = input.employmentType;
      if (input.monthlyBasicSalary !== undefined) employee.monthlyBasicSalary = input.monthlyBasicSalary;
      return repository.save(employee);
    });
  }

  async deactivateEmployee(id: string): Promise<Employee> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Employee);
      const employee = await repository.findOne({ where: { id } });
      if (!employee) {
        throw new NotFoundException(`Employee ${id} not found`);
      }
      if (!employee.isActive) {
        throw new ConflictException(`Employee ${id} is already deactivated`);
      }
      employee.isActive = false;
      return repository.save(employee);
    });
  }

  async reactivateEmployee(id: string): Promise<Employee> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Employee);
      const employee = await repository.findOne({ where: { id } });
      if (!employee) {
        throw new NotFoundException(`Employee ${id} not found`);
      }
      employee.isActive = true;
      return repository.save(employee);
    });
  }

  private validateEmployeeInput(
    input: Partial<CreateEmployeeInput>,
    options: { requireNameAndDate: boolean },
  ): void {
    if (options.requireNameAndDate) {
      if (!input.firstName?.trim()) {
        throw new BadRequestException('firstName is required');
      }
      if (!input.lastName?.trim()) {
        throw new BadRequestException('lastName is required');
      }
      if (!input.joinDate) {
        throw new BadRequestException('joinDate is required');
      }
    } else {
      if (input.firstName !== undefined && !input.firstName.trim()) {
        throw new BadRequestException('firstName cannot be blank');
      }
      if (input.lastName !== undefined && !input.lastName.trim()) {
        throw new BadRequestException('lastName cannot be blank');
      }
    }
    if (input.joinDate !== undefined && Number.isNaN(Date.parse(input.joinDate))) {
      throw new BadRequestException('joinDate must be a valid date');
    }
    if (input.employmentType !== undefined && !EMPLOYMENT_TYPES.includes(input.employmentType)) {
      throw new BadRequestException(`employmentType must be one of: ${EMPLOYMENT_TYPES.join(', ')}`);
    }
    if (
      input.monthlyBasicSalary !== undefined &&
      (!Number.isFinite(input.monthlyBasicSalary) || input.monthlyBasicSalary < 0)
    ) {
      throw new BadRequestException('monthlyBasicSalary must be a non-negative number');
    }
  }
}
