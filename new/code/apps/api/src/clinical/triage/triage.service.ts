import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TriageEntry } from './entities/triage-entry.entity.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';

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
  triagedBy?: string | null;
  triagedAt?: Date | null;
  status?: string;
  dischargeRemarks?: string | null;
}
export type UpdateTriageEntryInput = Partial<CreateTriageEntryInput>;

export interface TriageFilters {
  status?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class TriageService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async create(input: CreateTriageEntryInput): Promise<TriageEntry> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(TriageEntry);
      const entry = repository.create({
        ...input,
        status: input.status ?? 'Arrived',
        isPoliceCase: input.isPoliceCase ?? false,
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

      Object.assign(entry, input);

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

  async listActive(filters: TriageFilters = {}): Promise<PaginatedResponseDto<TriageEntry>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .getRepository(TriageEntry)
        .createQueryBuilder('t')
        .where('t.status NOT IN (:...closedStatuses)', { closedStatuses: CLOSED_STATUSES });
      
      if (filters.status) {
        qb.andWhere('t.status = :status', { status: filters.status });
      }
      
      qb.orderBy('t.acuityLevel', 'ASC');
      qb.addOrderBy('t.triagedAt', 'ASC');
      
      return paginate(qb, filters);
    });
  }
}
