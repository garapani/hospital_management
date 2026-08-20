import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { SsuCase, SsuCaseStatus } from './entities/ssu-case.entity.js';
import { SsuCaseNumberGeneratorService } from './ssu-case-number-generator.service.js';

export interface OpenCaseInput {
  patientId: string;
  caseType: string;
  eligibilityNotes?: string;
  subsidyPercent?: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  appliedBy?: string;
}

export interface DecideCaseInput {
  decisionNotes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  approvedBy?: string;
}

export interface ListCasesQuery extends PaginationQueryDto {
  patientId?: string;
  status?: SsuCaseStatus;
}

@Injectable()
export class SsuService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly caseNumberGenerator: SsuCaseNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`appliedBy`, `approvedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, so the audit trail of who applied for / decided a charity case can never be spoofed.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async openCase(input: OpenCaseInput): Promise<SsuCase> {
    if (!input.caseType?.trim()) {
      throw new BadRequestException('caseType is required');
    }
    if (
      input.subsidyPercent !== undefined &&
      (!Number.isFinite(input.subsidyPercent) || input.subsidyPercent < 0 || input.subsidyPercent > 100)
    ) {
      throw new BadRequestException('subsidyPercent must be between 0 and 100');
    }
    const caseNumber = await this.caseNumberGenerator.generateNextCaseNumber();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.query(`SELECT id FROM patients WHERE id = $1`, [input.patientId]);
      if (patient.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }
      return manager.getRepository(SsuCase).save(
        manager.getRepository(SsuCase).create({
          caseNumber,
          patientId: input.patientId,
          caseType: input.caseType.trim(),
          eligibilityNotes: input.eligibilityNotes ?? null,
          subsidyPercent: input.subsidyPercent ?? 0,
          status: 'Open',
          appliedBy: this.resolveActor(input.appliedBy),
          approvedBy: null,
          approvedAt: null,
          decisionNotes: null,
        }),
      );
    });
  }

  async listCases(query: ListCasesQuery = {}): Promise<PaginatedResponseDto<SsuCase>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(SsuCase).createQueryBuilder('ssuCase');
      if (query.patientId) {
        qb.andWhere('ssuCase.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.status) {
        qb.andWhere('ssuCase.status = :status', { status: query.status });
      }
      qb.orderBy('ssuCase.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getCase(id: string): Promise<SsuCase> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const ssuCase = await manager.getRepository(SsuCase).findOne({ where: { id } });
      if (!ssuCase) {
        throw new NotFoundException(`SSU case ${id} not found`);
      }
      return ssuCase;
    });
  }

  /** Open -> Approved: the deciding actor is the authenticated principal (§25). */
  async approveCase(id: string, input: DecideCaseInput = {}): Promise<SsuCase> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(SsuCase);
      const ssuCase = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ssuCase) {
        throw new NotFoundException(`SSU case ${id} not found`);
      }
      if (ssuCase.status !== 'Open') {
        throw new ConflictException(`SSU case ${id} cannot move from ${ssuCase.status} to Approved`);
      }
      ssuCase.status = 'Approved';
      ssuCase.approvedBy = this.resolveActor(input.approvedBy);
      ssuCase.approvedAt = new Date();
      ssuCase.decisionNotes = input.decisionNotes ?? ssuCase.decisionNotes;
      return repository.save(ssuCase);
    });
  }

  /** Open -> Rejected; a decision note is required to justify the rejection. */
  async rejectCase(id: string, input: DecideCaseInput): Promise<SsuCase> {
    const decisionNotes = input.decisionNotes?.trim();
    if (!decisionNotes) {
      throw new BadRequestException('decisionNotes are required to reject a case');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(SsuCase);
      const ssuCase = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ssuCase) {
        throw new NotFoundException(`SSU case ${id} not found`);
      }
      if (ssuCase.status !== 'Open') {
        throw new ConflictException(`SSU case ${id} cannot move from ${ssuCase.status} to Rejected`);
      }
      ssuCase.status = 'Rejected';
      ssuCase.approvedBy = this.resolveActor(input.approvedBy);
      ssuCase.approvedAt = new Date();
      ssuCase.decisionNotes = decisionNotes;
      return repository.save(ssuCase);
    });
  }

  /**
   * Approved/Rejected -> Closed. Open cases must be decided first. `actor` is accepted for
   * signature parity with the other transitions; the entity has no closure-actor column.
   */
  async closeCase(id: string, _actor?: string): Promise<SsuCase> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(SsuCase);
      const ssuCase = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!ssuCase) {
        throw new NotFoundException(`SSU case ${id} not found`);
      }
      if (ssuCase.status !== 'Approved' && ssuCase.status !== 'Rejected') {
        throw new ConflictException(`SSU case ${id} cannot move from ${ssuCase.status} to Closed`);
      }
      ssuCase.status = 'Closed';
      return repository.save(ssuCase);
    });
  }
}
