import { PaginationQueryDto } from '@hospital/pagination';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { SsuCaseStatus } from '../entities/ssu-case.entity.js';

export class ListCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsIn(['Open', 'Approved', 'Rejected', 'Closed'])
  status?: SsuCaseStatus;
}
