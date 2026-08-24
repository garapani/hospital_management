import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class SearchOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;
}
