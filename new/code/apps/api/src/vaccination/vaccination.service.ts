import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginatedResponseDto, PaginationQueryDto, paginate } from '@hospital/pagination';
import { VaccinationRecord } from './entities/vaccination-record.entity.js';

export interface RecordVaccinationInput {
  patientId: string;
  vaccine: string;
  doseNumber?: number;
  administeredDate: string;
  batchNumber?: string;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  administeredBy?: string;
}

export interface ListVaccinationRecordsQuery extends PaginationQueryDto {
  patientId?: string;
  vaccine?: string;
}

@Injectable()
export class VaccinationService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`administeredBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers. Vaccination administration is a clinical sign-off, so spoofing would be an
   * audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async record(input: RecordVaccinationInput): Promise<VaccinationRecord> {
    if (!input.vaccine?.trim()) {
      throw new BadRequestException('vaccine is required');
    }
    if (input.doseNumber !== undefined && (!Number.isInteger(input.doseNumber) || input.doseNumber < 1)) {
      throw new BadRequestException('doseNumber must be a positive integer');
    }
    if (!input.administeredDate?.trim()) {
      throw new BadRequestException('administeredDate is required');
    }
    if (Number.isNaN(new Date(input.administeredDate).getTime())) {
      throw new BadRequestException('administeredDate must be a valid date');
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.query(`SELECT id FROM patients WHERE id = $1`, [input.patientId]);
      if (patient.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      return manager.getRepository(VaccinationRecord).save(
        manager.getRepository(VaccinationRecord).create({
          patientId: input.patientId,
          vaccine: input.vaccine.trim(),
          doseNumber: input.doseNumber ?? 1,
          administeredDate: input.administeredDate.trim(),
          batchNumber: input.batchNumber ?? null,
          notes: input.notes ?? null,
          administeredBy: this.resolveActor(input.administeredBy),
        }),
      );
    });
  }

  async listRecords(
    query: ListVaccinationRecordsQuery = {},
  ): Promise<PaginatedResponseDto<VaccinationRecord>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(VaccinationRecord).createQueryBuilder('record');
      if (query.patientId) {
        qb.andWhere('record.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.vaccine) {
        qb.andWhere('record.vaccine = :vaccine', { vaccine: query.vaccine });
      }
      qb.orderBy('record.administeredDate', 'DESC').addOrderBy('record.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getRecord(id: string): Promise<VaccinationRecord> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const record = await manager.getRepository(VaccinationRecord).findOne({ where: { id } });
      if (!record) {
        throw new NotFoundException(`Vaccination record ${id} not found`);
      }
      return record;
    });
  }
}
