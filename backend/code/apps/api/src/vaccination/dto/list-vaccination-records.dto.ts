import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListVaccinationRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsString()
  vaccine?: string;
}
