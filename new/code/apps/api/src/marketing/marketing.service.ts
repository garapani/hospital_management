import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  PatientReferral,
  ReferralSource,
  ReferralSourceType,
} from './entities/marketing.entity.js';

export interface CreateSourceInput {
  name: string;
  sourceType?: ReferralSourceType;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  recordedBy?: string;
}

export interface RecordReferralInput {
  patientId: string;
  sourceId: string;
  referredByDoctorId?: string;
  referredAt?: string;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  recordedBy?: string;
}

const SOURCE_TYPES: ReferralSourceType[] = [
  'Doctor',
  'Walk-in',
  'Advertising',
  'Social Media',
  'Other',
];

@Injectable()
export class MarketingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`recordedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, so the audit trail of who recorded a referral can never be spoofed over HTTP.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Referral sources ----------

  async createSource(input: CreateSourceInput): Promise<ReferralSource> {
    if (!input.name?.trim()) {
      throw new BadRequestException('Source name is required');
    }
    const sourceType = input.sourceType ?? 'Other';
    if (!SOURCE_TYPES.includes(sourceType)) {
      throw new BadRequestException(`sourceType must be one of: ${SOURCE_TYPES.join(', ')}`);
    }
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(ReferralSource).save(
        manager.getRepository(ReferralSource).create({
          name: input.name.trim(),
          sourceType,
          isActive: true,
        }),
      ),
    );
  }

  async deactivateSource(id: string): Promise<ReferralSource> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(ReferralSource);
      const source = await repository.findOne({ where: { id } });
      if (!source) {
        throw new NotFoundException(`Referral source ${id} not found`);
      }
      if (!source.isActive) {
        throw new ConflictException(`Referral source ${id} is already deactivated`);
      }
      source.isActive = false;
      return repository.save(source);
    });
  }

  async reactivateSource(id: string): Promise<ReferralSource> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(ReferralSource);
      const source = await repository.findOne({ where: { id } });
      if (!source) {
        throw new NotFoundException(`Referral source ${id} not found`);
      }
      source.isActive = true;
      return repository.save(source);
    });
  }

  async listSources(): Promise<ReferralSource[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(ReferralSource).find({ order: { name: 'ASC' } }),
    );
  }

  // ---------- Patient referrals ----------

  async recordReferral(input: RecordReferralInput): Promise<PatientReferral> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.query(`SELECT id FROM patients WHERE id = $1`, [input.patientId]);
      if (patient.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      const sources = await manager.query(
        `SELECT id, "isActive" FROM referral_sources WHERE id = $1`,
        [input.sourceId],
      );
      if (sources.length === 0) {
        throw new NotFoundException(`Referral source ${input.sourceId} not found`);
      }
      if (!sources[0].isActive) {
        throw new ConflictException(
          `Referral source ${input.sourceId} is deactivated; cannot record a referral against it`,
        );
      }

      let referredAt: Date;
      if (input.referredAt !== undefined) {
        referredAt = new Date(input.referredAt);
        if (Number.isNaN(referredAt.getTime())) {
          throw new BadRequestException('referredAt must be a valid date');
        }
      } else {
        referredAt = new Date();
      }

      return manager.getRepository(PatientReferral).save(
        manager.getRepository(PatientReferral).create({
          patientId: input.patientId,
          sourceId: input.sourceId,
          referredByDoctorId: input.referredByDoctorId ?? null,
          referredAt,
          notes: input.notes ?? null,
          recordedBy: this.resolveActor(input.recordedBy),
        }),
      );
    });
  }

  async listReferrals(
    query: PaginationQueryDto & { patientId?: string; sourceId?: string },
  ): Promise<PaginatedResponseDto<PatientReferral>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(PatientReferral).createQueryBuilder('referral');
      if (query.patientId) {
        qb.andWhere('referral.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.sourceId) {
        qb.andWhere('referral.sourceId = :sourceId', { sourceId: query.sourceId });
      }
      qb.orderBy('referral.referredAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getReferral(id: string): Promise<PatientReferral> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const referral = await manager.getRepository(PatientReferral).findOne({ where: { id } });
      if (!referral) {
        throw new NotFoundException(`Patient referral ${id} not found`);
      }
      return referral;
    });
  }
}
