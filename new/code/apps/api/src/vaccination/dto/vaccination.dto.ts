import { PaginationQueryDto } from '@hospital/pagination';

export class CreateVaccinationRecordDto {
  patientId!: string;
  vaccine!: string;
  doseNumber?: number;
  /** ISO date (YYYY-MM-DD) on which the dose was administered. */
  administeredDate!: string;
  batchNumber?: string;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  administeredBy?: string;
}

export class ListVaccinationRecordsQueryDto extends PaginationQueryDto {
  patientId?: string;
  vaccine?: string;
}
