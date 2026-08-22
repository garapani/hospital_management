import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchPurchaseOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  vendorId?: string;
}
