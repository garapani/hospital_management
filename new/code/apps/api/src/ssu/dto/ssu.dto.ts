import { PaginationQueryDto } from '@hospital/pagination';
import { SsuCaseStatus } from '../entities/ssu-case.entity.js';

export class CreateCaseDto {
  patientId!: string;
  caseType!: string;
  eligibilityNotes?: string;
  subsidyPercent?: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  appliedBy?: string;
}

export class ApproveCaseDto {
  decisionNotes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  approvedBy?: string;
}

export class RejectCaseDto {
  decisionNotes!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  approvedBy?: string;
}

export class ListCasesQueryDto extends PaginationQueryDto {
  patientId?: string;
  status?: SsuCaseStatus;
}
