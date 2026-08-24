import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class SearchLabRequisitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderItemId?: string;
}
