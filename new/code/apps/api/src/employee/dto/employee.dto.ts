import { EmploymentType } from '../entities/employee.entity.js';

export class CreateEmployeeDto {
  firstName!: string;
  lastName!: string;
  departmentId?: string;
  designation?: string;
  phone?: string;
  email?: string;
  joinDate!: string;
  employmentType?: EmploymentType;
  monthlyBasicSalary?: number;
  /** Deprecated — ignored by the service (§25); kept so existing callers keep working. */
  createdBy?: string;
}

export class UpdateEmployeeDto {
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

export class ListEmployeesQueryDto {
  departmentId?: string;
  employmentType?: EmploymentType;
  q?: string;
}
