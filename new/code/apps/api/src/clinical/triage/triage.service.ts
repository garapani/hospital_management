import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { TriageEntry } from './entities/triage-entry.entity.js';
import { SearchTriageDto } from './dto/search-triage.dto.js';

const CLOSED_STATUSES = ['Discharged', 'Admitted', 'Deceased'];

export interface CreateTriageEntryInput {
  patientId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  gender?: string | null;
  estimatedAge?: string | null;
  arrivalMode?: string | null;
  broughtBy?: string | null;
  isPoliceCase?: boolean;
  chiefComplaint?: string | null;
  acuityLevel?: number | null;
  colorCode?: string | null;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  triagedBy?: string;
  triagedAt?: Date | null;
  status?: string;
  dischargeRemarks?: string | null;
}
export type UpdateTriageEntryInput = Partial<CreateTriageEntryInput>;

@Injectable()
export class TriageService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor field (`triagedBy`) is never trusted from the caller: the authenticated principal
   * (TenantContextService.accountId, set by TenantContextMiddleware from the verified JWT) wins;
   * the passed value is only a fallback for non-HTTP callers (service specs) that run without a
   * tenant context. It is a clinical sign-off, so spoofing it would be an audit-trail integrity
   * breach. (`broughtBy` is a factual arrival detail reported by the patient/attendant, not an
   * actor field, and remains client-suppliable.)
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async create(input: CreateTriageEntryInput): Promise<TriageEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(TriageEntry);
      const entry = repository.create({
        ...input,
        status: input.status ?? 'Arrived',
        isPoliceCase: input.isPoliceCase ?? false,
        triagedBy: this.resolveActor(input.triagedBy),
      });
      return repository.save(entry);
    });
  }

  async findOne(id: string): Promise<TriageEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const entry = await manager.getRepository(TriageEntry).findOne({ where: { id } });
      if (!entry) {
        throw new NotFoundException(`Triage entry ${id} not found`);
      }
      return entry;
    });
  }

  async update(id: string, input: UpdateTriageEntryInput): Promise<TriageEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(TriageEntry);
      const entry = await repository.findOne({ where: { id } });

      if (!entry) {
        throw new NotFoundException(`Triage entry ${id} not found`);
      }

      const { triagedBy, ...rest } = input;
      Object.assign(entry, rest);
      if (triagedBy !== undefined) {
        entry.triagedBy = this.resolveActor(triagedBy);
      }

      return repository.save(entry);
    });
  }

  async linkPatient(id: string, patientId: string): Promise<TriageEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(TriageEntry);
      const entry = await repository.findOne({ where: { id } });

      if (!entry) {
        throw new NotFoundException(`Triage entry ${id} not found`);
      }

      entry.patientId = patientId;

      return repository.save(entry);
    });
  }

  async listActive(query: SearchTriageDto = {}): Promise<PaginatedResponseDto<TriageEntry>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .getRepository(TriageEntry)
        .createQueryBuilder('t')
        .where('t.status NOT IN (:...closedStatuses)', { closedStatuses: CLOSED_STATUSES })
        .orderBy('t.acuityLevel', 'ASC')
        .addOrderBy('t.triagedAt', 'ASC');
      return paginate(qb, query);
    });
  }
}
