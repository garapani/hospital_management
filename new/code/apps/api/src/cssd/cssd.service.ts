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
  CssdInstrument,
  CssdSterilizationCycle,
  SterilizationCycleStatus,
  SterilizationMethod,
} from './entities/cssd.entity.js';

export interface CreateInstrumentInput {
  code: string;
  name: string;
  category?: string;
  quantity?: number;
}

export interface UpdateInstrumentInput {
  name?: string;
  category?: string;
  quantity?: number;
}

export interface StartCycleInput {
  instrumentId: string;
  method: SterilizationMethod;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

export interface CompleteCycleInput {
  sterileHours: number;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

export interface FailCycleInput {
  failureReason: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  operatedBy?: string;
}

const METHODS: SterilizationMethod[] = ['Steam', 'ETO', 'Chemical'];
const HOUR_MS = 60 * 60 * 1000;

@Injectable()
export class CssdService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`operatedBy`) derive from the authenticated principal (see
   * Development-Standards.md §25) — the caller-supplied value is only a fallback for non-HTTP
   * callers, and operating a sterilization cycle is a clinical sign-off where spoofing would be
   * an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Instruments ----------

  async createInstrument(input: CreateInstrumentInput): Promise<CssdInstrument> {
    if (!input.code?.trim()) {
      throw new BadRequestException('Instrument code is required');
    }
    if (!input.name?.trim()) {
      throw new BadRequestException('Instrument name is required');
    }
    if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity < 0)) {
      throw new BadRequestException('quantity must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(CssdInstrument).save(
        manager.getRepository(CssdInstrument).create({
          code: input.code.trim(),
          name: input.name.trim(),
          category: input.category ?? null,
          quantity: input.quantity ?? 0,
          isActive: true,
        }),
      ),
    );
  }

  async listInstruments(): Promise<CssdInstrument[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(CssdInstrument).find({ order: { code: 'ASC' } }),
    );
  }

  async updateInstrument(id: string, input: UpdateInstrumentInput): Promise<CssdInstrument> {
    if (input.name !== undefined && !input.name?.trim()) {
      throw new BadRequestException('Instrument name is required');
    }
    if (input.quantity !== undefined && (!Number.isFinite(input.quantity) || input.quantity < 0)) {
      throw new BadRequestException('quantity must be a non-negative number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CssdInstrument);
      const instrument = await repository.findOne({ where: { id } });
      if (!instrument) {
        throw new NotFoundException(`CSSD instrument ${id} not found`);
      }
      if (input.name !== undefined) instrument.name = input.name.trim();
      if (input.category !== undefined) instrument.category = input.category;
      if (input.quantity !== undefined) instrument.quantity = input.quantity;
      return repository.save(instrument);
    });
  }

  /** Soft-delete: the catalog entry stays (history) but can no longer start new cycles. */
  async deactivateInstrument(id: string): Promise<CssdInstrument> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CssdInstrument);
      const instrument = await repository.findOne({ where: { id } });
      if (!instrument) {
        throw new NotFoundException(`CSSD instrument ${id} not found`);
      }
      if (!instrument.isActive) {
        throw new ConflictException(`CSSD instrument ${id} is already deactivated`);
      }
      instrument.isActive = false;
      return repository.save(instrument);
    });
  }

  async reactivateInstrument(id: string): Promise<CssdInstrument> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CssdInstrument);
      const instrument = await repository.findOne({ where: { id } });
      if (!instrument) {
        throw new NotFoundException(`CSSD instrument ${id} not found`);
      }
      instrument.isActive = true;
      return repository.save(instrument);
    });
  }

  // ---------- Sterilization cycles ----------

  async startCycle(input: StartCycleInput): Promise<CssdSterilizationCycle> {
    if (!METHODS.includes(input.method)) {
      throw new BadRequestException(`Method must be one of: ${METHODS.join(', ')}`);
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const instrument = await manager.getRepository(CssdInstrument).findOne({
        where: { id: input.instrumentId },
      });
      if (!instrument) {
        throw new NotFoundException(`CSSD instrument ${input.instrumentId} not found`);
      }
      if (!instrument.isActive) {
        throw new ConflictException(
          `CSSD instrument ${input.instrumentId} is deactivated; cannot start a cycle for it`,
        );
      }
      return manager.getRepository(CssdSterilizationCycle).save(
        manager.getRepository(CssdSterilizationCycle).create({
          instrumentId: input.instrumentId,
          method: input.method,
          status: 'InProgress',
          startedAt: new Date(),
          completedAt: null,
          sterileExpiryAt: null,
          operatedBy: this.resolveActor(input.operatedBy),
          failureReason: null,
        }),
      );
    });
  }

  /** InProgress -> Completed: instruments are sterile until completedAt + sterileHours. */
  async completeCycle(id: string, input: CompleteCycleInput): Promise<CssdSterilizationCycle> {
    if (!Number.isFinite(input.sterileHours) || input.sterileHours <= 0) {
      throw new BadRequestException('sterileHours must be a positive number');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CssdSterilizationCycle);
      const cycle = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!cycle) {
        throw new NotFoundException(`CSSD sterilization cycle ${id} not found`);
      }
      if (cycle.status !== 'InProgress') {
        throw new ConflictException(
          `CSSD sterilization cycle ${id} cannot move from ${cycle.status} to Completed`,
        );
      }
      const completedAt = new Date();
      cycle.status = 'Completed';
      cycle.completedAt = completedAt;
      cycle.sterileExpiryAt = new Date(completedAt.getTime() + input.sterileHours * HOUR_MS);
      cycle.operatedBy = this.resolveActor(input.operatedBy);
      return repository.save(cycle);
    });
  }

  /** InProgress -> Failed: the cycle aborted; the operator records why. */
  async failCycle(id: string, input: FailCycleInput): Promise<CssdSterilizationCycle> {
    if (!input.failureReason?.trim()) {
      throw new BadRequestException('failureReason is required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(CssdSterilizationCycle);
      const cycle = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!cycle) {
        throw new NotFoundException(`CSSD sterilization cycle ${id} not found`);
      }
      if (cycle.status !== 'InProgress') {
        throw new ConflictException(
          `CSSD sterilization cycle ${id} cannot move from ${cycle.status} to Failed`,
        );
      }
      cycle.status = 'Failed';
      cycle.failureReason = input.failureReason.trim();
      cycle.operatedBy = this.resolveActor(input.operatedBy);
      return repository.save(cycle);
    });
  }

  async listCycles(
    query: PaginationQueryDto & { instrumentId?: string; status?: SterilizationCycleStatus },
  ): Promise<PaginatedResponseDto<CssdSterilizationCycle>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(CssdSterilizationCycle).createQueryBuilder('cycle');
      if (query.instrumentId) {
        qb.andWhere('cycle.instrumentId = :instrumentId', { instrumentId: query.instrumentId });
      }
      if (query.status) {
        qb.andWhere('cycle.status = :status', { status: query.status });
      }
      qb.orderBy('cycle.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  async getCycle(id: string): Promise<CssdSterilizationCycle> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const cycle = await manager.getRepository(CssdSterilizationCycle).findOne({ where: { id } });
      if (!cycle) {
        throw new NotFoundException(`CSSD sterilization cycle ${id} not found`);
      }
      return cycle;
    });
  }
}
