import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { InsurancePayer, InsurancePayerType } from './entities/insurance-payer.entity.js';
import { PatientPolicy } from './entities/patient-policy.entity.js';
import {
  InsuranceClaim,
  InsuranceClaimStatus,
} from './entities/insurance-claim.entity.js';
import { InsuranceClaimNumberGeneratorService } from './insurance-claim-number-generator.service.js';

export interface CreatePayerInput {
  name: string;
  type: InsurancePayerType;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

export interface UpdatePayerInput {
  name?: string;
  type?: InsurancePayerType;
  contactPerson?: string;
  phone?: string;
  address?: string;
}

export interface CreatePolicyInput {
  patientId: string;
  payerId: string;
  policyNumber: string;
  insuredName?: string;
  relationshipToInsured?: string;
  coverageStartDate: string;
  coverageEndDate: string;
  sumInsured: number;
  copayPercent?: number;
}

export interface UpdatePolicyInput {
  policyNumber?: string;
  insuredName?: string;
  relationshipToInsured?: string;
  coverageStartDate?: string;
  coverageEndDate?: string;
  sumInsured?: number;
  copayPercent?: number;
}

export interface CreateClaimInput {
  patientId: string;
  policyId: string;
  invoiceId: string;
  amountClaimed: number;
  remarks?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  submittedBy?: string;
}

export interface CoverageResult {
  eligible: boolean;
  policyId: string;
  payerName: string;
  coverageStartDate: string;
  coverageEndDate: string;
  copayPercent: number;
  sumInsured: number;
  reason?: string;
}

const PAYER_TYPES: InsurancePayerType[] = ['Government', 'Private'];

@Injectable()
export class InsuranceClaimsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly claimNumberGenerator: InsuranceClaimNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`submittedBy`, `processedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, and claim submission/approval are the money-relevant actions where spoofing would be
   * an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Payers ----------

  async createPayer(input: CreatePayerInput): Promise<InsurancePayer> {
    if (!input.name?.trim()) {
      throw new BadRequestException('Payer name is required');
    }
    if (!PAYER_TYPES.includes(input.type)) {
      throw new BadRequestException(`Payer type must be one of: ${PAYER_TYPES.join(', ')}`);
    }
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InsurancePayer).save(
        manager.getRepository(InsurancePayer).create({
          name: input.name.trim(),
          type: input.type,
          contactPerson: input.contactPerson ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
        }),
      ),
    );
  }

  async listPayers(): Promise<InsurancePayer[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(InsurancePayer).find({ order: { name: 'ASC' } }),
    );
  }

  async updatePayer(id: string, input: UpdatePayerInput): Promise<InsurancePayer> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsurancePayer);
      const payer = await repository.findOne({ where: { id } });
      if (!payer) {
        throw new NotFoundException(`Insurance payer ${id} not found`);
      }
      if (input.type !== undefined && !PAYER_TYPES.includes(input.type)) {
        throw new BadRequestException(`Payer type must be one of: ${PAYER_TYPES.join(', ')}`);
      }
      if (input.name !== undefined) payer.name = input.name;
      if (input.type !== undefined) payer.type = input.type;
      if (input.contactPerson !== undefined) payer.contactPerson = input.contactPerson;
      if (input.phone !== undefined) payer.phone = input.phone;
      if (input.address !== undefined) payer.address = input.address;
      return repository.save(payer);
    });
  }

  async deactivatePayer(id: string): Promise<InsurancePayer> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsurancePayer);
      const payer = await repository.findOne({ where: { id } });
      if (!payer) {
        throw new NotFoundException(`Insurance payer ${id} not found`);
      }
      if (!payer.isActive) {
        throw new ConflictException(`Insurance payer ${id} is already deactivated`);
      }
      payer.isActive = false;
      return repository.save(payer);
    });
  }

  async reactivatePayer(id: string): Promise<InsurancePayer> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsurancePayer);
      const payer = await repository.findOne({ where: { id } });
      if (!payer) {
        throw new NotFoundException(`Insurance payer ${id} not found`);
      }
      payer.isActive = true;
      return repository.save(payer);
    });
  }

  // ---------- Policies ----------

  async createPolicy(input: CreatePolicyInput): Promise<PatientPolicy> {
    this.validatePolicyInput(input);
    if (new Date(input.coverageStartDate) > new Date(input.coverageEndDate)) {
      throw new BadRequestException('coverageStartDate must not be after coverageEndDate');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const payer = await manager.getRepository(InsurancePayer).findOne({ where: { id: input.payerId } });
      if (!payer) {
        throw new NotFoundException(`Insurance payer ${input.payerId} not found`);
      }
      if (!payer.isActive) {
        throw new ConflictException(`Insurance payer ${input.payerId} is deactivated; cannot create a policy under it`);
      }
      const patient = await manager.query(`SELECT id FROM patients WHERE id = $1`, [input.patientId]);
      if (patient.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      return manager.getRepository(PatientPolicy).save(
        manager.getRepository(PatientPolicy).create({
          patientId: input.patientId,
          payerId: input.payerId,
          policyNumber: input.policyNumber,
          insuredName: input.insuredName ?? null,
          relationshipToInsured: input.relationshipToInsured ?? null,
          coverageStartDate: input.coverageStartDate,
          coverageEndDate: input.coverageEndDate,
          sumInsured: input.sumInsured,
          copayPercent: input.copayPercent ?? 0,
        }),
      );
    });
  }

  async listPolicies(query: PaginationQueryDto & { patientId?: string }): Promise<PaginatedResponseDto<PatientPolicy>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(PatientPolicy).createQueryBuilder('policy');
      if (query.patientId) {
        qb.andWhere('policy.patientId = :patientId', { patientId: query.patientId });
      }
      qb.orderBy('policy.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getPolicy(id: string): Promise<PatientPolicy> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const policy = await manager.getRepository(PatientPolicy).findOne({ where: { id } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${id} not found`);
      }
      return policy;
    });
  }

  async updatePolicy(id: string, input: UpdatePolicyInput): Promise<PatientPolicy> {
    this.validatePolicyInput(input);
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PatientPolicy);
      const policy = await repository.findOne({ where: { id } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${id} not found`);
      }
      if (input.policyNumber !== undefined) policy.policyNumber = input.policyNumber;
      if (input.insuredName !== undefined) policy.insuredName = input.insuredName;
      if (input.relationshipToInsured !== undefined) policy.relationshipToInsured = input.relationshipToInsured;
      if (input.coverageStartDate !== undefined) policy.coverageStartDate = input.coverageStartDate;
      if (input.coverageEndDate !== undefined) policy.coverageEndDate = input.coverageEndDate;
      if (input.sumInsured !== undefined) policy.sumInsured = input.sumInsured;
      if (input.copayPercent !== undefined) policy.copayPercent = input.copayPercent;
      if (new Date(policy.coverageStartDate) > new Date(policy.coverageEndDate)) {
        throw new BadRequestException('coverageStartDate must not be after coverageEndDate');
      }
      return repository.save(policy);
    });
  }

  async deactivatePolicy(id: string): Promise<PatientPolicy> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PatientPolicy);
      const policy = await repository.findOne({ where: { id } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${id} not found`);
      }
      if (!policy.isActive) {
        throw new ConflictException(`Patient policy ${id} is already deactivated`);
      }
      policy.isActive = false;
      return repository.save(policy);
    });
  }

  async reactivatePolicy(id: string): Promise<PatientPolicy> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(PatientPolicy);
      const policy = await repository.findOne({ where: { id } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${id} not found`);
      }
      policy.isActive = true;
      return repository.save(policy);
    });
  }

  /** Eligibility check: policy active AND the given date falls inside the coverage window. */
  async checkCoverage(policyId: string, date: string = new Date().toISOString().slice(0, 10)): Promise<CoverageResult> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const policy = await manager.getRepository(PatientPolicy).findOne({ where: { id: policyId } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${policyId} not found`);
      }
      const payer = await manager.getRepository(InsurancePayer).findOne({ where: { id: policy.payerId } });
      const inWindow = date >= policy.coverageStartDate && date <= policy.coverageEndDate;
      const eligible = policy.isActive && inWindow;
      return {
        eligible,
        policyId: policy.id,
        payerName: payer?.name ?? policy.payerId,
        coverageStartDate: policy.coverageStartDate,
        coverageEndDate: policy.coverageEndDate,
        copayPercent: policy.copayPercent,
        sumInsured: policy.sumInsured,
        reason: eligible ? undefined : !policy.isActive ? 'policy-inactive' : 'outside-coverage-window',
      };
    });
  }

  // ---------- Claims ----------

  async createClaim(input: CreateClaimInput): Promise<InsuranceClaim> {
    if (!Number.isFinite(input.amountClaimed) || input.amountClaimed <= 0) {
      throw new BadRequestException('amountClaimed must be a positive number');
    }
    const claimNumber = await this.claimNumberGenerator.generateNextClaimNumber();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const policy = await manager.getRepository(PatientPolicy).findOne({ where: { id: input.policyId } });
      if (!policy) {
        throw new NotFoundException(`Patient policy ${input.policyId} not found`);
      }
      if (policy.patientId !== input.patientId) {
        throw new BadRequestException(`Policy ${input.policyId} does not belong to patient ${input.patientId}`);
      }
      if (!policy.isActive) {
        throw new ConflictException(`Patient policy ${input.policyId} is deactivated`);
      }
      const invoice = await manager.query(
        `SELECT id FROM invoices WHERE id = $1 AND "patientId" = $2`,
        [input.invoiceId, input.patientId],
      );
      if (invoice.length === 0) {
        throw new NotFoundException(`Invoice ${input.invoiceId} not found for patient ${input.patientId}`);
      }

      return manager.getRepository(InsuranceClaim).save(
        manager.getRepository(InsuranceClaim).create({
          claimNumber,
          patientId: input.patientId,
          policyId: input.policyId,
          invoiceId: input.invoiceId,
          amountClaimed: input.amountClaimed,
          status: 'Draft',
          remarks: input.remarks ?? null,
          submittedBy: this.resolveActor(input.submittedBy),
          processedBy: null,
          submittedAt: null,
          processedAt: null,
        }),
      );
    });
  }

  async listClaims(
    query: PaginationQueryDto & { patientId?: string; status?: InsuranceClaimStatus },
  ): Promise<PaginatedResponseDto<InsuranceClaim>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(InsuranceClaim).createQueryBuilder('claim');
      if (query.patientId) {
        qb.andWhere('claim.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.status) {
        qb.andWhere('claim.status = :status', { status: query.status });
      }
      qb.orderBy('claim.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getClaim(id: string): Promise<InsuranceClaim> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const claim = await manager.getRepository(InsuranceClaim).findOne({ where: { id } });
      if (!claim) {
        throw new NotFoundException(`Insurance claim ${id} not found`);
      }
      return claim;
    });
  }

  /** Draft -> Submitted: the submitter is the authenticated actor (audit-relevant). */
  async submitClaim(id: string, actor?: string): Promise<InsuranceClaim> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsuranceClaim);
      const claim = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!claim) {
        throw new NotFoundException(`Insurance claim ${id} not found`);
      }
      if (claim.status !== 'Draft') {
        throw new ConflictException(`Insurance claim ${id} cannot move from ${claim.status} to Submitted`);
      }
      claim.status = 'Submitted';
      claim.submittedBy = this.resolveActor(actor);
      claim.submittedAt = new Date();
      claim.processedBy = this.resolveActor(actor);
      claim.processedAt = new Date();
      return repository.save(claim);
    });
  }

  async approveClaim(id: string, amountApproved: number, actor?: string): Promise<InsuranceClaim> {
    if (!Number.isFinite(amountApproved) || amountApproved <= 0) {
      throw new BadRequestException('amountApproved must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsuranceClaim);
      const claim = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!claim) {
        throw new NotFoundException(`Insurance claim ${id} not found`);
      }
      if (claim.status !== 'Submitted') {
        throw new ConflictException(`Insurance claim ${id} must be Submitted to be approved (current: ${claim.status})`);
      }
      if (amountApproved > claim.amountClaimed) {
        throw new BadRequestException(
          `amountApproved ${amountApproved} exceeds amountClaimed ${claim.amountClaimed}`,
        );
      }
      claim.status = 'Approved';
      claim.amountApproved = amountApproved;
      claim.processedBy = this.resolveActor(actor);
      claim.processedAt = new Date();
      return repository.save(claim);
    });
  }

  async rejectClaim(id: string, remarks: string, actor?: string): Promise<InsuranceClaim> {
    if (!remarks?.trim()) {
      throw new BadRequestException('Rejection remarks are required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsuranceClaim);
      const claim = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!claim) {
        throw new NotFoundException(`Insurance claim ${id} not found`);
      }
      if (claim.status !== 'Submitted') {
        throw new ConflictException(`Insurance claim ${id} must be Submitted to be rejected (current: ${claim.status})`);
      }
      claim.status = 'Rejected';
      claim.remarks = remarks.trim();
      claim.processedBy = this.resolveActor(actor);
      claim.processedAt = new Date();
      return repository.save(claim);
    });
  }

  /** Approved -> Paid: the payer has reimbursed; amountApproved must have been set. */
  async markClaimPaid(id: string, actor?: string): Promise<InsuranceClaim> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(InsuranceClaim);
      const claim = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!claim) {
        throw new NotFoundException(`Insurance claim ${id} not found`);
      }
      if (claim.status !== 'Approved') {
        throw new ConflictException(`Insurance claim ${id} must be Approved to be paid (current: ${claim.status})`);
      }
      claim.status = 'Paid';
      claim.processedBy = this.resolveActor(actor);
      claim.processedAt = new Date();
      return repository.save(claim);
    });
  }

  private validatePolicyInput(input: Partial<CreatePolicyInput>): void {
    if (input.sumInsured !== undefined && (!Number.isFinite(input.sumInsured) || input.sumInsured < 0)) {
      throw new BadRequestException('sumInsured must be a non-negative number');
    }
    if (
      input.copayPercent !== undefined &&
      (!Number.isFinite(input.copayPercent) || input.copayPercent < 0 || input.copayPercent > 100)
    ) {
      throw new BadRequestException('copayPercent must be between 0 and 100');
    }
    if (!input.policyNumber?.trim()) {
      throw new BadRequestException('policyNumber is required');
    }
  }
}
