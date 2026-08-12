import { PaginationQueryDto } from '@hospital/pagination';

export class SearchPatientsDto extends PaginationQueryDto {
  q?: string;
  phoneNumber?: string;
  patientNo?: string;
}
