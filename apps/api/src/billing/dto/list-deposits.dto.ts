import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class ListDepositsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;
}
