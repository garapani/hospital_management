import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { SsuCaseStatus } from '../entities/ssu-case.entity.js';

export class CreateCaseDto {
  @IsString()
  patientId!: string;

  @IsString()
  caseType!: string;

  @IsOptional()
  @IsString()
  eligibilityNotes?: string;

  @IsOptional()
  @IsNumber()
  subsidyPercent?: number;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  appliedBy?: string;
}

export class ApproveCaseDto {
  @IsOptional()
  @IsString()
  decisionNotes?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class RejectCaseDto {
  @IsString()
  decisionNotes!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  approvedBy?: string;
}

export class ListCasesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsIn(['Open', 'Approved', 'Rejected', 'Closed'])
  status?: SsuCaseStatus;
}
