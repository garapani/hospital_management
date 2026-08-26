import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class ListEntriesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;
}
