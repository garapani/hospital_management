import { ReferralSourceType } from '../entities/marketing.entity.js';

export class CreateSourceDto {
  name!: string;
  sourceType?: ReferralSourceType;
}

export class RecordReferralDto {
  patientId!: string;
  sourceId!: string;
  referredByDoctorId?: string;
  referredAt?: string;
  notes?: string;
}

export class ListReferralsQueryDto {
  page?: number;
  limit?: number;
  patientId?: string;
  sourceId?: string;
}
