import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import { DeliveryType, MaternityRecord } from './entities/maternity-record.entity.js';

export interface CreateMaternityRecordInput {
  admissionId: string;
  patientId: string;
  gravida?: number;
  para?: number;
  lmp?: string;
  edd?: string;
  notes?: string;
  /** Deprecated — a delivery outcome is only ever recorded via recordDelivery (see §25). */
  deliveredBy?: string;
}

export interface UpdateMaternityRecordInput {
  gravida?: number;
  para?: number;
  lmp?: string;
  edd?: string;
  notes?: string;
}

export interface RecordDeliveryInput {
  deliveryDate: string;
  deliveryType: DeliveryType;
  babyCount: number;
  complications?: string;
  notes?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  deliveredBy?: string;
}

const DELIVERY_TYPES: DeliveryType[] = ['Normal', 'C-Section', 'Instrumental'];

@Injectable()
export class MaternityService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * `deliveredBy` is a clinical sign-off — never trusted from the caller: the authenticated
   * principal (TenantContextService.accountId, set by TenantContextMiddleware from the verified
   * JWT) wins; the passed value is only a fallback for non-HTTP callers (service specs) that run
   * without a tenant context. Spoofing it would be an audit-trail integrity breach (see
   * Development-Standards.md §25).
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  /**
   * Creates the antenatal record. The delivery outcome columns stay null — they are only ever
   * filled in by recordDelivery (a one-way clinical sign-off, never editable afterwards).
   */
  async createRecord(input: CreateMaternityRecordInput): Promise<MaternityRecord> {
    this.validateAntenatalFields(input.gravida, input.para, input.lmp, input.edd);
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertAdmissionBelongsToPatient(manager, input.admissionId, input.patientId);
      const existing = await manager.getRepository(MaternityRecord).findOne({
        where: { admissionId: input.admissionId },
      });
      if (existing) {
        throw new ConflictException(`Admission ${input.admissionId} already has a maternity record`);
      }
      try {
        return await manager.getRepository(MaternityRecord).save(
          manager.getRepository(MaternityRecord).create({
            admissionId: input.admissionId,
            patientId: input.patientId,
            gravida: input.gravida ?? 0,
            para: input.para ?? 0,
            lmp: input.lmp ?? null,
            edd: input.edd ?? null,
            deliveryDate: null,
            deliveryType: null,
            babyCount: 0,
            complications: null,
            deliveredBy: null,
            notes: input.notes ?? null,
          }),
        );
      } catch (error) {
        // Backstop for the race the pre-check above can't close: concurrent creates for the
        // same admission, closed by UQ_maternity_records_admission.
        if (
          error instanceof QueryFailedError &&
          (error as QueryFailedError & { constraint?: string }).constraint ===
            'UQ_maternity_records_admission'
        ) {
          throw new ConflictException(`Admission ${input.admissionId} already has a maternity record`);
        }
        throw error;
      }
    });
  }

  async listRecords(
    query: PaginationQueryDto & { patientId?: string; admissionId?: string },
  ): Promise<PaginatedResponseDto<MaternityRecord>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(MaternityRecord).createQueryBuilder('record');
      if (query.patientId) {
        qb.andWhere('record.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.admissionId) {
        qb.andWhere('record.admissionId = :admissionId', { admissionId: query.admissionId });
      }
      qb.orderBy('record.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getRecord(id: string): Promise<MaternityRecord> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const record = await manager.getRepository(MaternityRecord).findOne({ where: { id } });
      if (!record) {
        throw new NotFoundException(`Maternity record ${id} not found`);
      }
      return record;
    });
  }

  /**
   * Records the delivery outcome. One-way: once deliveryDate is set, neither recordDelivery nor
   * updateRecord may touch the outcome again (row-locked transition, like the nursing status
   * machine — the "current state" being "delivery recorded" vs "not recorded").
   */
  async recordDelivery(id: string, input: RecordDeliveryInput): Promise<MaternityRecord> {
    if (!input.deliveryDate) {
      throw new BadRequestException('deliveryDate is required');
    }
    if (!DELIVERY_TYPES.includes(input.deliveryType)) {
      throw new BadRequestException(`deliveryType must be one of: ${DELIVERY_TYPES.join(', ')}`);
    }
    if (!Number.isFinite(input.babyCount) || input.babyCount < 1) {
      throw new BadRequestException('babyCount must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(MaternityRecord);
      const record = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!record) {
        throw new NotFoundException(`Maternity record ${id} not found`);
      }
      if (record.deliveryDate) {
        throw new ConflictException(
          `Maternity record ${id} delivery already recorded on ${record.deliveryDate}`,
        );
      }
      record.deliveryDate = input.deliveryDate;
      record.deliveryType = input.deliveryType;
      record.babyCount = input.babyCount;
      record.complications = input.complications ?? null;
      if (input.notes !== undefined) {
        record.notes = input.notes;
      }
      record.deliveredBy = this.resolveActor(input.deliveredBy);
      return repository.save(record);
    });
  }

  /**
   * PATCHes the antenatal fields only. Once the delivery outcome is recorded the record becomes
   * immutable (the delivery is a clinical sign-off).
   */
  async updateRecord(id: string, input: UpdateMaternityRecordInput): Promise<MaternityRecord> {
    this.validateAntenatalFields(input.gravida, input.para, input.lmp, input.edd);
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(MaternityRecord);
      const record = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!record) {
        throw new NotFoundException(`Maternity record ${id} not found`);
      }
      if (record.deliveryDate) {
        throw new ConflictException(
          `Maternity record ${id} delivery already recorded; antenatal fields cannot be edited`,
        );
      }
      if (input.gravida !== undefined) record.gravida = input.gravida;
      if (input.para !== undefined) record.para = input.para;
      if (input.lmp !== undefined) record.lmp = input.lmp;
      if (input.edd !== undefined) record.edd = input.edd;
      if (input.notes !== undefined) record.notes = input.notes;
      // The lmp/edd ordering check runs against the merged state, so a partial PATCH can't smuggle
      // in an invalid pair.
      if (record.lmp && record.edd && record.lmp > record.edd) {
        throw new BadRequestException('lmp must not be after edd');
      }
      return repository.save(record);
    });
  }

  private validateAntenatalFields(
    gravida: number | undefined,
    para: number | undefined,
    lmp: string | undefined,
    edd: string | undefined,
  ): void {
    if (gravida !== undefined && (!Number.isFinite(gravida) || gravida < 0)) {
      throw new BadRequestException('gravida must be a non-negative number');
    }
    if (para !== undefined && (!Number.isFinite(para) || para < 0)) {
      throw new BadRequestException('para must be a non-negative number');
    }
    if (lmp !== undefined && edd !== undefined && lmp > edd) {
      throw new BadRequestException('lmp must not be after edd');
    }
  }

  /** Cross-module reference check (see insurance module): no entity import, raw lookup only. */
  private async assertAdmissionBelongsToPatient(
    manager: EntityManager,
    admissionId: string,
    patientId: string,
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT id, "patientId" FROM admissions WHERE id = $1`,
      [admissionId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Admission ${admissionId} not found`);
    }
    if (rows[0].patientId !== patientId) {
      throw new BadRequestException(
        `Admission ${admissionId} does not belong to patient ${patientId}`,
      );
    }
  }
}
