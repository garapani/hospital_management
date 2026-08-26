import { IsDateString, IsEmail, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { EmploymentType } from '../entities/employee.entity.js';

export class CreateEmployeeDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  // UUID-typed column — the read DTO already uses @IsUUID; a string here would 500 on the FK
  // (code-review-findings-2026-08-25 employee P3).
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsDateString()
  joinDate!: string;

  @IsOptional()
  @IsIn(['FullTime', 'PartTime', 'Contract'])
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber()
  monthlyBasicSalary?: number;

  /** Deprecated — ignored by the service (§25); kept so existing callers keep working. */
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsDateString()
  joinDate?: string;

  @IsOptional()
  @IsIn(['FullTime', 'PartTime', 'Contract'])
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber()
  monthlyBasicSalary?: number;
}

// Extends PaginationQueryDto — without it the ValidationPipe strips page/limit and the list is
// permanently pinned to the service's default page size (code-review-findings-2026-08-25
// employee P2).
export class ListEmployeesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(['FullTime', 'PartTime', 'Contract'])
  employmentType?: EmploymentType;

  @IsOptional()
  @IsString()
  q?: string;
}
