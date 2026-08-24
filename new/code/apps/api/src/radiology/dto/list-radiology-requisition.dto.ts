import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListRadiologyRequisitionDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  imagingItemId?: string;
}
