import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { OtSurgery, OtSurgeryStatus } from './entities/ot-surgery.entity.js';
import { OtSurgeryNumberGeneratorService } from './ot-surgery-number-generator.service.js';

export interface ScheduleSurgeryInput {
  patientId: string;
  admissionId?: string;
  procedureName: string;
  otRoom?: string;
  scheduledAt?: string | Date;
  surgeonId?: string;
  anesthesiologistId?: string;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  scheduledBy?: string;
}

@Injectable()
export class OtService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly surgeryNumberGenerator: OtSurgeryNumberGeneratorService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`scheduledBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, so a spoofed scheduler never wins over the verified JWT.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async scheduleSurgery(input: ScheduleSurgeryInput): Promise<OtSurgery> {
    if (!input.procedureName?.trim()) {
      throw new BadRequestException('procedureName is required');
    }
    if (
      input.scheduledAt !== undefined &&
      input.scheduledAt !== null &&
      Number.isNaN(new Date(input.scheduledAt).getTime())
    ) {
      throw new BadRequestException('scheduledAt must be a valid date');
    }
    const surgeryNumber = await this.surgeryNumberGenerator.generateNextSurgeryNumber();
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const patient = await manager.query(`SELECT id FROM patients WHERE id = $1`, [input.patientId]);
      if (patient.length === 0) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }
      if (input.admissionId) {
        const admission = await manager.query(
          `SELECT id, "patientId" FROM admissions WHERE id = $1`,
          [input.admissionId],
        );
        if (admission.length === 0) {
          throw new NotFoundException(`Admission ${input.admissionId} not found`);
        }
        if (admission[0].patientId !== input.patientId) {
          throw new BadRequestException(
            `Admission ${input.admissionId} does not belong to patient ${input.patientId}`,
          );
        }
      }

      return manager.getRepository(OtSurgery).save(
        manager.getRepository(OtSurgery).create({
          surgeryNumber,
          patientId: input.patientId,
          admissionId: input.admissionId ?? null,
          procedureName: input.procedureName.trim(),
          otRoom: input.otRoom ?? null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          surgeonId: input.surgeonId ?? null,
          anesthesiologistId: input.anesthesiologistId ?? null,
          notes: input.notes ?? null,
          status: 'Scheduled',
          startedAt: null,
          endedAt: null,
          scheduledBy: this.resolveActor(input.scheduledBy),
        }),
      );
    });
  }

  async listSurgeries(
    query: PaginationQueryDto & { status?: OtSurgeryStatus; patientId?: string },
  ): Promise<PaginatedResponseDto<OtSurgery>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(OtSurgery).createQueryBuilder('surgery');
      if (query.status) {
        qb.andWhere('surgery.status = :status', { status: query.status });
      }
      if (query.patientId) {
        qb.andWhere('surgery.patientId = :patientId', { patientId: query.patientId });
      }
      qb.orderBy('surgery.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getSurgery(id: string): Promise<OtSurgery> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const surgery = await manager.getRepository(OtSurgery).findOne({ where: { id } });
      if (!surgery) {
        throw new NotFoundException(`Surgery ${id} not found`);
      }
      return surgery;
    });
  }

  /** Scheduled -> InProgress: the theatre session starts; startedAt is stamped now. */
  async startSurgery(id: string, actor?: string): Promise<OtSurgery> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(OtSurgery);
      const surgery = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!surgery) {
        throw new NotFoundException(`Surgery ${id} not found`);
      }
      if (surgery.status !== 'Scheduled') {
        throw new ConflictException(`Surgery ${id} cannot move from ${surgery.status} to InProgress`);
      }
      surgery.status = 'InProgress';
      surgery.startedAt = new Date();
      return repository.save(surgery);
    });
  }

  /** InProgress -> Completed: the surgery finishes; endedAt is stamped now. */
  async completeSurgery(id: string, actor?: string): Promise<OtSurgery> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(OtSurgery);
      const surgery = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!surgery) {
        throw new NotFoundException(`Surgery ${id} not found`);
      }
      if (surgery.status !== 'InProgress') {
        throw new ConflictException(`Surgery ${id} cannot move from ${surgery.status} to Completed`);
      }
      surgery.status = 'Completed';
      surgery.endedAt = new Date();
      return repository.save(surgery);
    });
  }

  /** Scheduled -> Cancelled: only a not-yet-started surgery can be cancelled. */
  async cancelSurgery(id: string, actor?: string): Promise<OtSurgery> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(OtSurgery);
      const surgery = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!surgery) {
        throw new NotFoundException(`Surgery ${id} not found`);
      }
      if (surgery.status !== 'Scheduled') {
        throw new ConflictException(`Surgery ${id} cannot move from ${surgery.status} to Cancelled`);
      }
      surgery.status = 'Cancelled';
      return repository.save(surgery);
    });
  }
}
