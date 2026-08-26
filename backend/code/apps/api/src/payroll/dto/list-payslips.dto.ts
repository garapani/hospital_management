import { PaginationQueryDto } from '@hospital/pagination';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID } from 'class-validator';
import type { PayslipStatus } from '../entities/payslip.entity.js';

export class ListPayslipsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;

  @IsOptional()
  @IsIn(['Draft', 'Paid'])
  status?: PayslipStatus;
}
