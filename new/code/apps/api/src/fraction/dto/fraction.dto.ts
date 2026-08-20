import { PaginationQueryDto } from '@hospital/pagination';

export class CreateRuleDto {
  doctorId!: string;
  departmentId?: string;
  fractionPercent!: number;
}

export class CreateEntryDto {
  invoiceId!: string;
  doctorId!: string;
  ruleId?: string;
  baseAmount?: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  recordedBy?: string;
}

export class ListRulesQueryDto extends PaginationQueryDto {
  doctorId?: string;
}

export class ListEntriesQueryDto extends PaginationQueryDto {
  invoiceId?: string;
  doctorId?: string;
}
