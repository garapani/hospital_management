import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchStockBalancesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  itemId?: string;
}
