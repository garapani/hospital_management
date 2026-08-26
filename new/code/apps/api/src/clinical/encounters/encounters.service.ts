import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { paginate, PaginatedResponseDto, PaginationQueryDto } from '@hospital/pagination';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { Diagnosis } from './entities/diagnosis.entity.js';
import { Prescription } from './entities/prescription.entity.js';
import { Patient } from '../../patients/entities/patient.entity.js';

// keyof SoftDeletableEntity (not the old literal 'createdAt' | 'updatedAt'): these entities now also
// carry createdBy/updatedBy/deletedAt/deletedBy, all system-populated by AuditColumnsSubscriber,
// never part of a create/update input.
export type CreateNoteInput = Omit<ClinicalNote, 'id' | keyof SoftDeletableEntity | 'status' | 'doctorId'> & {
  doctorId?: string;
};
export type UpdateNoteInput = Partial<Omit<ClinicalNote, 'id' | keyof SoftDeletableEntity | 'patientId' | 'doctorId' | 'appointmentId'>>;

export type CreateDiagnosisInput = Omit<Diagnosis, 'id' | keyof SoftDeletableEntity | 'doctorId'> & { doctorId?: string };
export type CreatePrescriptionInput = Omit<Prescription, 'id' | keyof SoftDeletableEntity | 'status' | 'doctorId'> & {
  doctorId?: string;
};

@Injectable()
export class EncountersService {
  constructor(
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * `doctorId` on a clinical note/diagnosis/prescription is never trusted from the caller: the
   * authenticated principal (TenantContextService.accountId, set by AuthContextMiddleware from the
   * verified JWT) wins; the passed value is only a fallback for non-HTTP callers (service specs)
   * that run without a tenant context. Spoofing the clinical author would be an audit-trail
   * integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  private async assertPatientExists(manager: EntityManager, patientId: string): Promise<void> {
    const patient = await manager.getRepository(Patient).findOne({ where: { id: patientId } });
    if (!patient) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }

  // --- Clinical Notes ---
  async createNote(input: CreateNoteInput): Promise<ClinicalNote> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientExists(manager, input.patientId);
      const repository = manager.getRepository(ClinicalNote);
      const note = repository.create({ ...input, doctorId: this.resolveActor(input.doctorId) });
      return repository.save(note);
    });
  }

  async updateNote(id: string, input: UpdateNoteInput): Promise<ClinicalNote> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(ClinicalNote);
      const note = await repository.findOne({ where: { id } });
      if (!note) {
        throw new NotFoundException(`ClinicalNote ${id} not found`);
      }
      // Once signed, a note is a clinical record of what was documented at sign-off time — locked
      // the same way a reviewed discharge summary is (AdmissionsService.updateDischargeSummary).
      // The transition INTO 'Signed' itself is still this same call (status is still 'Draft' at
      // the point this check runs), so signing isn't blocked — only edits after signing are.
      if (note.status === 'Signed') {
        throw new ConflictException(`ClinicalNote ${id} is signed and can no longer be edited`);
      }
      Object.assign(note, input);
      return repository.save(note);
    });
  }

  async getNotesByPatient(patientId: string, query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<ClinicalNote>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(ClinicalNote, 'note')
        .where('note.patientId = :patientId', { patientId })
        .orderBy('note.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  // --- Diagnoses ---
  async createDiagnosis(input: CreateDiagnosisInput): Promise<Diagnosis> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientExists(manager, input.patientId);
      const repository = manager.getRepository(Diagnosis);
      const diagnosis = repository.create({ ...input, doctorId: this.resolveActor(input.doctorId) });
      return repository.save(diagnosis);
    });
  }

  async deleteDiagnosis(id: string): Promise<void> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Diagnosis);
      const diagnosis = await repository.findOne({ where: { id } });
      if (!diagnosis) {
        throw new NotFoundException(`Diagnosis ${id} not found`);
      }
      // Soft delete (Diagnosis extends SoftDeletableEntity) — see deletePrescription below.
      await repository.softRemove(diagnosis);
    });
  }

  async getDiagnosesByPatient(patientId: string, query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<Diagnosis>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(Diagnosis, 'diagnosis')
        .where('diagnosis.patientId = :patientId', { patientId })
        .orderBy('diagnosis.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }

  // --- Prescriptions ---
  async createPrescription(input: CreatePrescriptionInput): Promise<Prescription> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      await this.assertPatientExists(manager, input.patientId);
      const repository = manager.getRepository(Prescription);
      const prescription = repository.create({ ...input, doctorId: this.resolveActor(input.doctorId) });
      return repository.save(prescription);
    });
  }

  private async transitionPrescription(id: string, nextStatus: 'Discontinued' | 'Completed'): Promise<Prescription> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Prescription);
      const prescription = await repository.findOne({ where: { id } });
      if (!prescription) {
        throw new NotFoundException(`Prescription ${id} not found`);
      }
      if (prescription.status !== 'Active') {
        throw new ConflictException(
          `Prescription ${id} is ${prescription.status}, not Active — cannot mark it ${nextStatus}`,
        );
      }
      prescription.status = nextStatus;
      return repository.save(prescription);
    });
  }

  /** Doctor-initiated: the prescriber is stopping the medication before its planned course ends. */
  async discontinuePrescription(id: string): Promise<Prescription> {
    return this.transitionPrescription(id, 'Discontinued');
  }

  /** The medication ran its full course as prescribed. */
  async completePrescription(id: string): Promise<Prescription> {
    return this.transitionPrescription(id, 'Completed');
  }

  async deletePrescription(id: string): Promise<void> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Prescription);
      const prescription = await repository.findOne({ where: { id } });
      if (!prescription) {
        throw new NotFoundException(`Prescription ${id} not found`);
      }
      // Soft delete (Prescription extends SoftDeletableEntity): deletedAt/deletedBy populated by
      // AuditColumnsSubscriber, row excluded from normal find()/query-builder reads afterward.
      await repository.softRemove(prescription);
    });
  }

  async getPrescriptionsByPatient(patientId: string, query: PaginationQueryDto = {}): Promise<PaginatedResponseDto<Prescription>> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(Prescription, 'prescription')
        .where('prescription.patientId = :patientId', { patientId })
        .orderBy('prescription.createdAt', 'DESC');
      return paginate(qb, query);
    });
  }
}
