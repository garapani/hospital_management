import { PaginationQueryDto } from '@hospital/pagination';

export class SearchAppointmentsDto extends PaginationQueryDto {
  date?: string;
  doctorId?: string;
  departmentId?: string;
  status?: string;
}
