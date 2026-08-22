import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';
import type { InsurancePayerType } from '../entities/insurance-payer.entity.js';
import type { InsuranceClaimStatus } from '../entities/insurance-claim.entity.js';

export class CreatePayerDto {
  @IsString()
  name!: string;

  @IsIn(['Government', 'Private'])
  type!: InsurancePayerType;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

// Was previously bound in the controller as `PaginationQueryDto & { patientId?: string }` — an
// inline intersection type with no runtime class, so Nest couldn't resolve a metatype for it and
// skipped validation entirely regardless of `whitelist` (see 2.14 Phase B / claude-code-tasks.md
// 2.18). A real `extends`-based class fixes that.
export class ListPoliciesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;
}

export class UpdatePayerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['Government', 'Private'])
  type?: InsurancePayerType;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class CreatePolicyDto {
  @IsString()
  patientId!: string;

  @IsString()
  payerId!: string;

  @IsString()
  policyNumber!: string;

  @IsOptional()
  @IsString()
  insuredName?: string;

  @IsOptional()
  @IsString()
  relationshipToInsured?: string;

  @IsDateString()
  coverageStartDate!: string;

  @IsDateString()
  coverageEndDate!: string;

  @IsNumber()
  @Min(0)
  sumInsured!: number;

  @IsOptional()
  @IsNumber()
  copayPercent?: number;
}

export class UpdatePolicyDto {
  @IsOptional()
  @IsString()
  policyNumber?: string;

  @IsOptional()
  @IsString()
  insuredName?: string;

  @IsOptional()
  @IsString()
  relationshipToInsured?: string;

  @IsOptional()
  @IsDateString()
  coverageStartDate?: string;

  @IsOptional()
  @IsDateString()
  coverageEndDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sumInsured?: number;

  @IsOptional()
  @IsNumber()
  copayPercent?: number;
}

export class CreateClaimDto {
  @IsString()
  patientId!: string;

  @IsString()
  policyId!: string;

  @IsString()
  invoiceId!: string;

  @IsNumber()
  @Min(0)
  amountClaimed!: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ApproveClaimDto {
  @IsNumber()
  @Min(0)
  amountApproved!: number;
}

export class RejectClaimDto {
  @IsString()
  remarks!: string;
}

export class CheckCoverageQueryDto {
  @IsOptional()
  @IsString()
  date?: string;
}

export class ListClaimsQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsIn(['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'])
  status?: InsuranceClaimStatus;
}
