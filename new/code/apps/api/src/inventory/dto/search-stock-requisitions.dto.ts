import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchStockRequisitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
