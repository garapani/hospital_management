import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchAppointmentsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}
