import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { Admission } from './entities/admission.entity.js';
import { BedTransfer } from './entities/bed-transfer.entity.js';
import { DischargeSummary } from './entities/discharge-summary.entity.js';
import { Bed } from '../master-data/entities/bed.entity.js';
import { TriageEntry } from '../clinical/triage/entities/triage-entry.entity.js';
import { Patient } from '../patients/entities/patient.entity.js';
import { paginate, PaginatedResponseDto } from '@hospital/pagination';
import { SearchAdmissionsDto } from './dto/search-admissions.dto.js';

export interface CreateAdmissionInput {
  patientId: string;
  admissionSource: string; // expected: 'OPD' | 'ER' | 'Direct'
  sourceAppointmentId?: string;
  sourceTriageEntryId?: string;
  admittingDoctorId: string;
  bedId: string;
}

export interface TransferAdmissionInput {
  toBedId: string;
  transferredBy?: string;
  reason?: string;
}

export interface DischargeAdmissionInput {
  dischargedBy?: string;
  dischargeType?: string;
  dischargeCondition?: string;
  dischargeSummary?: string;
}

export interface CreateDischargeSummaryInput {
  admissionId: string;
  patientId: string;
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  proceduresPerformed?: string[];
  hospitalCourse?: string;
  dischargeMedications?: string;
  followUpInstructions?: string;
  warningSigns?: string;
  activityRestrictions?: string;
  followUpAppointmentDate?: Date;
  followUpDoctorId?: string;
  dietRecommendations?: string;
  additionalNotes?: string;
  preparedBy?: string;
}

export interface UpdateDischargeSummaryInput {
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  proceduresPerformed?: string[];
  hospitalCourse?: string;
  dischargeMedications?: string;
  followUpInstructions?: string;
  warningSigns?: string;
  activityRestrictions?: string;
  followUpAppointmentDate?: Date;
  followUpDoctorId?: string;
  dietRecommendations?: string;
  additionalNotes?: string;
  reviewedBy?: string;
}

@Injectable()
export class AdmissionsService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Actor fields (`transferredBy`, `dischargedBy`, `preparedBy`, `reviewedBy`) are never trusted
   * from the caller: the authenticated principal (TenantContextService.accountId, set by
   * TenantContextMiddleware from the verified JWT) wins; the passed value is only a fallback for
   * non-HTTP callers (service specs) that run without a tenant context. `reviewedBy` is a
   * clinical sign-off, so spoofing it would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async admit(input: CreateAdmissionInput): Promise<Admission> {
    if (input.sourceAppointmentId && input.sourceTriageEntryId) {
      throw new BadRequestException(
        'An admission can have at most one source: sourceAppointmentId or sourceTriageEntryId, not both',
      );
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      let triageEntry: TriageEntry | null = null;
      if (input.sourceTriageEntryId) {
        triageEntry = await manager.getRepository(TriageEntry).findOne({ where: { id: input.sourceTriageEntryId } });
        if (!triageEntry) {
          throw new NotFoundException(`Triage entry ${input.sourceTriageEntryId} not found`);
        }
        if (!triageEntry.patientId) {
          throw new BadRequestException(
            `Triage entry ${input.sourceTriageEntryId} must be linked to a patient before it can be admitted`,
          );
        }
        if (triageEntry.patientId !== input.patientId) {
          throw new BadRequestException(
            `Triage entry ${input.sourceTriageEntryId} is linked to a different patient than the one being admitted`,
          );
        }
      }

      const patient = await manager.getRepository(Patient).findOne({ where: { id: input.patientId } });
      if (!patient) {
        throw new NotFoundException(`Patient ${input.patientId} not found`);
      }

      const admissionRepositoryForCheck = manager.getRepository(Admission);
      const activeAdmission = await admissionRepositoryForCheck.findOne({
        where: { patientId: input.patientId, status: 'Admitted' },
      });
      if (activeAdmission) {
        throw new ConflictException(`Patient ${input.patientId} already has an active admission`);
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: input.bedId } });
      if (!bed) {
        throw new NotFoundException(`Bed ${input.bedId} not found`);
      }
      if (bed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.bedId} is not available (status: ${bed.status})`);
      }

      const admissionRepository = manager.getRepository(Admission);
      let admission: Admission;
      try {
        admission = await admissionRepository.save(
          admissionRepository.create({
            patientId: input.patientId,
            admissionSource: input.admissionSource,
            sourceAppointmentId: input.sourceAppointmentId ?? null,
            sourceTriageEntryId: input.sourceTriageEntryId ?? null,
            admittingDoctorId: input.admittingDoctorId,
            wardId: bed.wardId,
            bedId: bed.id,
            status: 'Admitted',
          }),
        );
      } catch (error) {
        if (error instanceof QueryFailedError) {
          const constraint = (error as QueryFailedError & { constraint?: string }).constraint;
          if (constraint === 'UQ_admissions_active_patient') {
            throw new ConflictException(`Patient ${input.patientId} already has an active admission`);
          }
          if (constraint === 'UQ_admissions_active_bed' || (error as QueryFailedError & { code?: string }).code === '23505') {
            throw new ConflictException(`Bed ${input.bedId} is not available (status: Occupied)`);
          }
        }
        throw error;
      }

      bed.status = 'Occupied';
      await bedRepository.save(bed);

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId: null,
          toBedId: bed.id,
          transferredBy: input.admittingDoctorId,
          reason: 'Initial admission',
        }),
      );

      if (triageEntry) {
        triageEntry.status = 'Admitted';
        await manager.getRepository(TriageEntry).save(triageEntry);
      }

      return admission;
    });
  }

  async findOne(id: string): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admission = await manager.getRepository(Admission).findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      return admission;
    });
  }

  async list(query: SearchAdmissionsDto): Promise<PaginatedResponseDto<Admission>> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(Admission).createQueryBuilder('admission');
      
      if (query.wardId) {
        qb.andWhere('admission.wardId = :wardId', { wardId: query.wardId });
      }
      if (query.patientId) {
        qb.andWhere('admission.patientId = :patientId', { patientId: query.patientId });
      }
      if (query.status) {
        qb.andWhere('admission.status = :status', { status: query.status });
      }
      
      qb.orderBy('admission.admissionDate', 'DESC');
      return paginate(qb, query);
    });
  }

  async listActive(wardId?: string): Promise<Admission[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Admission).find({
        where: wardId ? { status: 'Admitted', wardId } : { status: 'Admitted' },
        order: { admissionDate: 'DESC' },
      }),
    );
  }

  async transfer(id: string, input: TransferAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const toBed = await bedRepository.findOne({ where: { id: input.toBedId } });
      if (!toBed) {
        throw new NotFoundException(`Bed ${input.toBedId} not found`);
      }
      if (toBed.status !== 'Available') {
        throw new ConflictException(`Bed ${input.toBedId} is not available (status: ${toBed.status})`);
      }

      const fromBedId = admission.bedId;
      const fromBed = await bedRepository.findOne({ where: { id: fromBedId } });
      if (fromBed) {
        fromBed.status = 'Available';
        await bedRepository.save(fromBed);
      }

      toBed.status = 'Occupied';
      await bedRepository.save(toBed);

      admission.wardId = toBed.wardId;
      admission.bedId = toBed.id;
      let updated: Admission;
      try {
        updated = await admissionRepository.save(admission);
      } catch (error) {
        if (error instanceof QueryFailedError) {
          const constraint = (error as QueryFailedError & { constraint?: string }).constraint;
          if (constraint === 'UQ_admissions_active_bed' || (error as QueryFailedError & { code?: string }).code === '23505') {
            throw new ConflictException(`Bed ${input.toBedId} is not available (status: Occupied)`);
          }
        }
        throw error;
      }

      const bedTransferRepository = manager.getRepository(BedTransfer);
      await bedTransferRepository.save(
        bedTransferRepository.create({
          admissionId: admission.id,
          fromBedId,
          toBedId: toBed.id,
          transferredBy: this.resolveActor(input.transferredBy),
          reason: input.reason ?? null,
        }),
      );

      return updated;
    });
  }

  async discharge(id: string, input: DischargeAdmissionInput): Promise<Admission> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const admissionRepository = manager.getRepository(Admission);
      const admission = await admissionRepository.findOne({ where: { id } });
      if (!admission) {
        throw new NotFoundException(`Admission ${id} not found`);
      }
      if (admission.status === 'Discharged') {
        throw new ConflictException(`Admission ${id} is already discharged`);
      }

      const bedRepository = manager.getRepository(Bed);
      const bed = await bedRepository.findOne({ where: { id: admission.bedId } });
      if (bed) {
        bed.status = 'Available';
        await bedRepository.save(bed);
      }

      admission.status = 'Discharged';
      admission.dischargeDate = new Date();
      admission.dischargeType = input.dischargeType ?? null;
      admission.dischargeCondition = input.dischargeCondition ?? null;
      admission.dischargeSummary = input.dischargeSummary ?? null;
      admission.dischargedBy = this.resolveActor(input.dischargedBy);

      return admissionRepository.save(admission);
    });
  }

  async createDischargeSummary(input: CreateDischargeSummaryInput): Promise<DischargeSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      // Verify admission exists and is discharged
      const admission = await manager.getRepository(Admission).findOne({ where: { id: input.admissionId } });
      if (!admission) {
        throw new NotFoundException(`Admission ${input.admissionId} not found`);
      }
      if (admission.status !== 'Discharged') {
        throw new ConflictException(`Discharge summary can only be created for discharged admissions. Admission ${input.admissionId} status: ${admission.status}`);
      }
      if (admission.patientId !== input.patientId) {
        throw new BadRequestException(`Patient ${input.patientId} does not match admission ${input.admissionId}`);
      }

      // Check if summary already exists for this admission
      const existing = await manager.getRepository(DischargeSummary).findOne({ where: { admissionId: input.admissionId } });
      if (existing) {
        throw new ConflictException(`Discharge summary already exists for admission ${input.admissionId}`);
      }

      const repository = manager.getRepository(DischargeSummary);
      return repository.save(
        repository.create({
          admissionId: input.admissionId,
          patientId: input.patientId,
          primaryDiagnosis: input.primaryDiagnosis ?? null,
          secondaryDiagnoses: input.secondaryDiagnoses ?? [],
          proceduresPerformed: input.proceduresPerformed ?? [],
          hospitalCourse: input.hospitalCourse ?? null,
          dischargeMedications: input.dischargeMedications ?? null,
          followUpInstructions: input.followUpInstructions ?? null,
          warningSigns: input.warningSigns ?? null,
          activityRestrictions: input.activityRestrictions ?? null,
          followUpAppointmentDate: input.followUpAppointmentDate ?? null,
          followUpDoctorId: input.followUpDoctorId ?? null,
          dietRecommendations: input.dietRecommendations ?? null,
          additionalNotes: input.additionalNotes ?? null,
          preparedBy: this.resolveActor(input.preparedBy),
        }),
      );
    });
  }

  async getDischargeSummaryByAdmission(admissionId: string): Promise<DischargeSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const summary = await manager.getRepository(DischargeSummary).findOne({ where: { admissionId } });
      if (!summary) {
        throw new NotFoundException(`Discharge summary for admission ${admissionId} not found`);
      }
      return summary;
    });
  }

  async getDischargeSummary(id: string): Promise<DischargeSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const summary = await manager.getRepository(DischargeSummary).findOne({ where: { id } });
      if (!summary) {
        throw new NotFoundException(`Discharge summary ${id} not found`);
      }
      return summary;
    });
  }

  async listDischargeSummaries(patientId?: string): Promise<DischargeSummary[]> {
    return this.tenantConnection.runInTenantSchema((manager) => {
      const qb = manager.getRepository(DischargeSummary).createQueryBuilder('ds');
      if (patientId) {
        qb.where('ds.patientId = :patientId', { patientId });
      }
      qb.orderBy('ds.createdAt', 'DESC');
      return qb.getMany();
    });
  }

  async updateDischargeSummary(id: string, input: UpdateDischargeSummaryInput): Promise<DischargeSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(DischargeSummary);
      const summary = await repository.findOne({ where: { id } });
      if (!summary) {
        throw new NotFoundException(`Discharge summary ${id} not found`);
      }
      if (summary.reviewedAt) {
        throw new ConflictException(`Discharge summary ${id} has already been reviewed and can no longer be edited`);
      }

      if (input.primaryDiagnosis !== undefined) summary.primaryDiagnosis = input.primaryDiagnosis;
      if (input.secondaryDiagnoses !== undefined) summary.secondaryDiagnoses = input.secondaryDiagnoses;
      if (input.proceduresPerformed !== undefined) summary.proceduresPerformed = input.proceduresPerformed;
      if (input.hospitalCourse !== undefined) summary.hospitalCourse = input.hospitalCourse;
      if (input.dischargeMedications !== undefined) summary.dischargeMedications = input.dischargeMedications;
      if (input.followUpInstructions !== undefined) summary.followUpInstructions = input.followUpInstructions;
      if (input.warningSigns !== undefined) summary.warningSigns = input.warningSigns;
      if (input.activityRestrictions !== undefined) summary.activityRestrictions = input.activityRestrictions;
      if (input.followUpAppointmentDate !== undefined) summary.followUpAppointmentDate = input.followUpAppointmentDate;
      if (input.followUpDoctorId !== undefined) summary.followUpDoctorId = input.followUpDoctorId;
      if (input.dietRecommendations !== undefined) summary.dietRecommendations = input.dietRecommendations;
      if (input.additionalNotes !== undefined) summary.additionalNotes = input.additionalNotes;
      if (input.reviewedBy !== undefined) {
        summary.reviewedBy = this.resolveActor(input.reviewedBy);
        summary.reviewedAt = new Date();
      }

      return repository.save(summary);
    });
  }

  async reviewDischargeSummary(id: string, reviewedBy?: string): Promise<DischargeSummary> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(DischargeSummary);
      const summary = await repository.findOne({ where: { id } });
      if (!summary) {
        throw new NotFoundException(`Discharge summary ${id} not found`);
      }
      if (summary.reviewedAt) {
        throw new ConflictException(`Discharge summary ${id} has already been reviewed`);
      }
      summary.reviewedBy = this.resolveActor(reviewedBy);
      summary.reviewedAt = new Date();
      return repository.save(summary);
    });
  }
}
