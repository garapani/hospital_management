import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchStockRequisitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  departmentId?: string;
}
