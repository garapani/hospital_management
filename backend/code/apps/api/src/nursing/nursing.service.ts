import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { PaginationQueryDto, PaginatedResponseDto, paginate } from '@hospital/pagination';
import {
  MedicationAdministration,
  NursingTask,
} from './entities/nursing.entity.js';

export interface CreateTaskInput {
  admissionId: string;
  taskType: string;
  description: string;
  dueAt?: Date | string;
  assignedTo?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  createdBy?: string;
}

export interface CreateAdministrationInput {
  admissionId: string;
  prescriptionId?: string;
  drugName: string;
  dose: string;
  route?: string;
  scheduledAt?: Date | string;
  notes?: string;
}

@Injectable()
export class NursingService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`createdBy`, `completedBy`, `administeredBy`) are never trusted from the
   * caller: the authenticated principal (TenantContextService.accountId, set by
   * TenantContextMiddleware from the verified JWT) wins; the passed value is only a fallback
   * for non-HTTP callers (service specs) that run without a tenant context. Completing a task
   * or administering a medication is a clinical sign-off, so spoofing it would be an
   * audit-trail integrity breach (see Development-Standards.md §25).
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  // ---------- Tasks ----------

  async createTask(input: CreateTaskInput): Promise<NursingTask> {
    if (!input.taskType?.trim()) {
      throw new BadRequestException('taskType is required');
    }
    if (!input.description?.trim()) {
      throw new BadRequestException('description is required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertAdmissionExists(manager, input.admissionId);
      return manager.getRepository(NursingTask).save(
        manager.getRepository(NursingTask).create({
          admissionId: input.admissionId,
          taskType: input.taskType.trim(),
          description: input.description.trim(),
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          status: 'Pending',
          assignedTo: input.assignedTo ?? null,
          completedBy: null,
          completedAt: null,
          createdBy: this.resolveActor(input.createdBy),
        }),
      );
    });
  }

  async listTasks(
    query: PaginationQueryDto & { admissionId?: string },
  ): Promise<PaginatedResponseDto<NursingTask>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(NursingTask).createQueryBuilder('task');
      if (query.admissionId) {
        await this.assertWardAccessForAdmissionId(manager, query.admissionId);
        qb.andWhere('task.admissionId = :admissionId', { admissionId: query.admissionId });
      } else {
        this.scopeToOwnWard(qb, 'task');
      }
      qb.orderBy('task.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  /** Pending -> InProgress: the task is now being worked on. */
  async startTask(id: string, actor?: string): Promise<NursingTask> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(NursingTask);
      const task = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!task) {
        throw new NotFoundException(`Nursing task ${id} not found`);
      }
      await this.assertWardAccessForAdmissionId(manager, task.admissionId);
      if (task.status !== 'Pending') {
        throw new ConflictException(`Nursing task ${id} cannot move from ${task.status} to InProgress`);
      }
      task.status = 'InProgress';
      return repository.save(task);
    });
  }

  /** InProgress -> Completed: the completing nurse is the authenticated actor (sign-off). */
  async completeTask(id: string, actor?: string): Promise<NursingTask> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(NursingTask);
      const task = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!task) {
        throw new NotFoundException(`Nursing task ${id} not found`);
      }
      await this.assertWardAccessForAdmissionId(manager, task.admissionId);
      if (task.status !== 'InProgress') {
        throw new ConflictException(`Nursing task ${id} cannot move from ${task.status} to Completed`);
      }
      task.status = 'Completed';
      task.completedBy = this.resolveActor(actor);
      task.completedAt = new Date();
      return repository.save(task);
    });
  }

  /** Pending -> Cancelled: recorded like a completion so the audit trail is uniform. */
  async cancelTask(id: string, actor?: string): Promise<NursingTask> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(NursingTask);
      const task = await repository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!task) {
        throw new NotFoundException(`Nursing task ${id} not found`);
      }
      await this.assertWardAccessForAdmissionId(manager, task.admissionId);
      if (task.status !== 'Pending') {
        throw new ConflictException(`Nursing task ${id} cannot move from ${task.status} to Cancelled`);
      }
      task.status = 'Cancelled';
      task.completedBy = this.resolveActor(actor);
      task.completedAt = new Date();
      return repository.save(task);
    });
  }

  // ---------- Medication Administration (MAR) ----------

  async createAdministration(input: CreateAdministrationInput): Promise<MedicationAdministration> {
    if (!input.drugName?.trim()) {
      throw new BadRequestException('drugName is required');
    }
    if (!input.dose?.trim()) {
      throw new BadRequestException('dose is required');
    }
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertAdmissionExists(manager, input.admissionId);
      if (input.prescriptionId) {
        await this.assertPrescriptionExists(manager, input.prescriptionId);
      }
      return manager.getRepository(MedicationAdministration).save(
        manager.getRepository(MedicationAdministration).create({
          admissionId: input.admissionId,
          prescriptionId: input.prescriptionId ?? null,
          drugName: input.drugName.trim(),
          dose: input.dose.trim(),
          route: input.route ?? null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          status: 'Scheduled',
          administeredBy: null,
          administeredAt: null,
          skippedBy: null,
          notes: input.notes ?? null,
        }),
      );
    });
  }

  async listAdministrations(
    query: PaginationQueryDto & { admissionId?: string },
  ): Promise<PaginatedResponseDto<MedicationAdministration>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.getRepository(MedicationAdministration).createQueryBuilder('administration');
      if (query.admissionId) {
        await this.assertWardAccessForAdmissionId(manager, query.admissionId);
        qb.andWhere('administration.admissionId = :admissionId', { admissionId: query.admissionId });
      } else {
        this.scopeToOwnWard(qb, 'administration');
      }
      qb.orderBy('administration.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  /** Scheduled -> Administered: the administering nurse is the authenticated actor (sign-off). */
  async administer(id: string, actor?: string): Promise<MedicationAdministration> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(MedicationAdministration);
      const administration = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!administration) {
        throw new NotFoundException(`Medication administration ${id} not found`);
      }
      await this.assertWardAccessForAdmissionId(manager, administration.admissionId);
      if (administration.status !== 'Scheduled') {
        throw new ConflictException(
          `Medication administration ${id} cannot move from ${administration.status} to Administered`,
        );
      }
      administration.status = 'Administered';
      administration.administeredBy = this.resolveActor(actor);
      administration.administeredAt = new Date();
      return repository.save(administration);
    });
  }

  /** Scheduled -> Skipped: optionally records why (e.g. patient refused, drug unavailable). */
  async skipAdministration(id: string, notes?: string, actor?: string): Promise<MedicationAdministration> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(MedicationAdministration);
      const administration = await repository.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!administration) {
        throw new NotFoundException(`Medication administration ${id} not found`);
      }
      await this.assertWardAccessForAdmissionId(manager, administration.admissionId);
      if (administration.status !== 'Scheduled') {
        throw new ConflictException(
          `Medication administration ${id} cannot move from ${administration.status} to Skipped`,
        );
      }
      administration.status = 'Skipped';
      administration.skippedBy = this.resolveActor(actor);
      if (notes !== undefined) {
        administration.notes = notes;
      }
      return repository.save(administration);
    });
  }

  /**
   * Cross-module reference check (see insurance module): no entity import, raw lookup only.
   * Also rejects a discharged admission — tasks/MAR lines only make sense against an active stay.
   */
  private async assertAdmissionExists(manager: EntityManager, admissionId: string): Promise<void> {
    const rows = await manager.query(`SELECT id, status, "wardId" FROM admissions WHERE id = $1`, [admissionId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Admission ${admissionId} not found`);
    }
    if (rows[0].status === 'Discharged') {
      throw new ConflictException(`Admission ${admissionId} is discharged`);
    }
    this.assertWardAccess(admissionId, rows[0].wardId);
  }

  /**
   * Ward-scoped row-level access (PRD §6.2: "Nurse can only write vitals for patients on their
   * assigned ward"): a staff account with no wardId assigned (TenantContextService.getWardId())
   * keeps today's tenant-wide access — the check only activates once a ward is explicitly
   * assigned. See review-comments.md, "PRD-promised ward-scoped row-level access for Nurse is
   * not implemented".
   */
  private assertWardAccess(admissionId: string, admissionWardId: string): void {
    const staffWardId = this.tenantContext.getWardId();
    if (staffWardId && staffWardId !== admissionWardId) {
      throw new ForbiddenException(`Admission ${admissionId} is outside your assigned ward`);
    }
  }

  /** Scopes an unfiltered list query to admissions on the staff member's assigned ward — a
   *  no-op (unrestricted) when they have none. Subquery rather than a join, matching
   *  assertAdmissionExists's "no cross-module entity import" convention for referencing
   *  admissions from here. */
  private scopeToOwnWard<T extends object>(qb: SelectQueryBuilder<T>, alias: string): void {
    const staffWardId = this.tenantContext.getWardId();
    if (staffWardId) {
      qb.andWhere(`${alias}.admissionId IN (SELECT id FROM admissions WHERE "wardId" = :staffWardId)`, {
        staffWardId,
      });
    }
  }

  /** Ward check for the action paths (start/complete/cancel/administer/skip), which only have an
   *  admissionId after the task/administration row is already fetched — a second, cheap lookup
   *  (short-circuits with no query at all for the common unrestricted-staff case). */
  private async assertWardAccessForAdmissionId(manager: EntityManager, admissionId: string): Promise<void> {
    const staffWardId = this.tenantContext.getWardId();
    if (!staffWardId) {
      return;
    }
    const rows = await manager.query(`SELECT "wardId" FROM admissions WHERE id = $1`, [admissionId]);
    this.assertWardAccess(admissionId, rows[0]?.wardId);
  }

  /** Cross-module reference check, same shape as assertAdmissionExists: no entity import. */
  private async assertPrescriptionExists(manager: EntityManager, prescriptionId: string): Promise<void> {
    const rows = await manager.query(`SELECT id FROM prescriptions WHERE id = $1`, [prescriptionId]);
    if (rows.length === 0) {
      throw new NotFoundException(`Prescription ${prescriptionId} not found`);
    }
  }
}
