import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString } from 'class-validator';

export class ListPendingPharmacyItemsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  status?: string;
}
