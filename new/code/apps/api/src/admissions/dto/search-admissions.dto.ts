import { PaginationQueryDto } from '@hospital/pagination';

export class SearchAdmissionsDto extends PaginationQueryDto {
  wardId?: string;
  patientId?: string;
  status?: string;
}
