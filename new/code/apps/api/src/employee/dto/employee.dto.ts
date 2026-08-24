import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
import type { EmploymentType } from '../entities/employee.entity.js';

export class CreateEmployeeDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
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

export class ListEmployeesQueryDto {
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
