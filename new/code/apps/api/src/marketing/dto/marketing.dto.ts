import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

import type { ReferralSourceType } from '../entities/marketing.entity.js';

const REFERRAL_SOURCE_TYPES = [
  'Doctor',
  'Walk-in',
  'Advertising',
  'Social Media',
  'Other',
] as const;

export class CreateSourceDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsIn(REFERRAL_SOURCE_TYPES)
  sourceType?: ReferralSourceType;
}

export class RecordReferralDto {
  @IsString()
  patientId!: string;

  @IsString()
  sourceId!: string;

  @IsOptional()
  @IsString()
  referredByDoctorId?: string;

  @IsOptional()
  @IsDateString()
  referredAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Extends PaginationQueryDto (not hand-rolled @IsNumber() page/limit) — see ot.dto.ts's
// ListSurgeriesQueryDto for why: a non-integer limit would otherwise reach paginate()'s
// .skip()/.take() as a float, which Postgres rejects with a 500 instead of a clean 400.
export class ListReferralsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
