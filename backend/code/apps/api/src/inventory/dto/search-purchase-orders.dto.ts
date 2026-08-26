import { IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchPurchaseOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;
}
