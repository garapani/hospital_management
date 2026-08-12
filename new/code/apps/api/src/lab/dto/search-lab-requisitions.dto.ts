import { PaginationQueryDto } from '@hospital/pagination';

export class SearchLabRequisitionsDto extends PaginationQueryDto {
  orderItemId?: string;
}
