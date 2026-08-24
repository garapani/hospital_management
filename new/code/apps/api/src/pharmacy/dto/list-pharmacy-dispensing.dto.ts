import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListPharmacyDispensingDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
