import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchStockBalancesDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;
}
