import { PaginationQueryDto } from '@hospital/pagination';

export class SearchOrdersDto extends PaginationQueryDto {
  patientId?: string;
}
