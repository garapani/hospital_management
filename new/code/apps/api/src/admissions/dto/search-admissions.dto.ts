import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchAdmissionsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  wardId?: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
