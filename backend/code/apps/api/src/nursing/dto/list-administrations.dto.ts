import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class ListAdministrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  admissionId?: string;
}
