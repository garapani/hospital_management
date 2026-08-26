import { PaginationQueryDto } from '@hospital/pagination';
import { IsOptional, IsUUID } from 'class-validator';

export class ListMaternityRecordsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  admissionId?: string;
}
