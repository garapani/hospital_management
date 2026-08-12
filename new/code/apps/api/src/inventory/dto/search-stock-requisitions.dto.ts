import { PaginationQueryDto } from '@hospital/pagination';

export class SearchStockRequisitionsDto extends PaginationQueryDto {
  departmentId?: string;
}
