import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class ListDepositsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;
}
