import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { TenantContextService } from '@hospital/tenant-context';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { Diagnosis } from './entities/diagnosis.entity.js';
import { Prescription } from './entities/prescription.entity.js';

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

  // --- Clinical Notes ---
  async createNote(input: CreateNoteInput): Promise<ClinicalNote> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
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
      Object.assign(note, input);
      return repository.save(note);
    });
  }

  async getNotesByPatient(patientId: string): Promise<ClinicalNote[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager.getRepository(ClinicalNote).find({ where: { patientId }, order: { createdAt: 'DESC' } });
    });
  }

  // --- Diagnoses ---
  async createDiagnosis(input: CreateDiagnosisInput): Promise<Diagnosis> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
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

  async getDiagnosesByPatient(patientId: string): Promise<Diagnosis[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager.getRepository(Diagnosis).find({ where: { patientId }, order: { createdAt: 'DESC' } });
    });
  }

  // --- Prescriptions ---
  async createPrescription(input: CreatePrescriptionInput): Promise<Prescription> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Prescription);
      const prescription = repository.create({ ...input, doctorId: this.resolveActor(input.doctorId) });
      return repository.save(prescription);
    });
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

  async getPrescriptionsByPatient(patientId: string): Promise<Prescription[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      return manager.getRepository(Prescription).find({ where: { patientId }, order: { createdAt: 'DESC' } });
    });
  }
}
