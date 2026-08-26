import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class SearchLabRequisitionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
