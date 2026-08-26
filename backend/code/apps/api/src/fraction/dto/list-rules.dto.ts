import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class ListRulesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
