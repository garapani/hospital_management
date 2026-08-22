import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString } from 'class-validator';

export class SearchLabRequisitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  orderItemId?: string;
}
