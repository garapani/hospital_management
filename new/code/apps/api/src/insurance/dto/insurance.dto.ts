import { InsurancePayerType } from '../entities/insurance-payer.entity.js';
import { InsuranceClaimStatus } from '../entities/insurance-claim.entity.js';

export class CreatePayerDto {
  name!: string;
  type!: InsurancePayerType;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

export class UpdatePayerDto {
  name?: string;
  type?: InsurancePayerType;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

export class CreatePolicyDto {
  patientId!: string;
  payerId!: string;
  policyNumber!: string;
  insuredName?: string;
  relationshipToInsured?: string;
  coverageStartDate!: string;
  coverageEndDate!: string;
  sumInsured!: number;
  copayPercent?: number;
}

export class UpdatePolicyDto {
  policyNumber?: string;
  insuredName?: string;
  relationshipToInsured?: string;
  coverageStartDate?: string;
  coverageEndDate?: string;
  sumInsured?: number;
  copayPercent?: number;
}

export class CreateClaimDto {
  patientId!: string;
  policyId!: string;
  invoiceId!: string;
  amountClaimed!: number;
  remarks?: string;
}

export class ApproveClaimDto {
  amountApproved!: number;
}

export class RejectClaimDto {
  remarks!: string;
}

export class CheckCoverageQueryDto {
  date?: string;
}

export class ListClaimsQueryDto {
  patientId?: string;
  status?: InsuranceClaimStatus;
}
