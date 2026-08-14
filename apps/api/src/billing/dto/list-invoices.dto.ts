import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class ListInvoicesDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;
}
