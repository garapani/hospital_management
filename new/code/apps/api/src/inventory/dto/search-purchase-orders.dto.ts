import { PaginationQueryDto } from '@hospital/pagination';

export class SearchPurchaseOrdersDto extends PaginationQueryDto {
  vendorId?: string;
}
