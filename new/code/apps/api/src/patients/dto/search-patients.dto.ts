import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

export class SearchPatientsDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  patientNo?: string;
}
