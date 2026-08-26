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
  // UUID-typed columns — the read DTOs already use @IsUUID; the write path must match or a bad
  // id turns an FK violation into a raw 500 (code-review-findings-2026-08-25 marketing P3).
  @IsUUID()
  patientId!: string;

  @IsUUID()
  sourceId!: string;

  @IsOptional()
  @IsUUID()
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
