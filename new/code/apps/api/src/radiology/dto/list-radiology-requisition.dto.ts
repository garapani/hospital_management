import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString } from 'class-validator';

export class ListRadiologyRequisitionDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  orderItemId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  imagingItemId?: string;
}
