import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  admissionId?: string;
}
