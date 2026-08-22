import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString } from 'class-validator';

export class SearchOrdersDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;
}
