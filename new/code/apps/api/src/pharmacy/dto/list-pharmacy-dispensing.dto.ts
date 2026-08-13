import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString } from 'class-validator';

export class ListPharmacyDispensingDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  orderItemId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
