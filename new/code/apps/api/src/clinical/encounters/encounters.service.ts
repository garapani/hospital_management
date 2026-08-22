import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { SoftDeletableEntity } from '../../database/auditable.entity.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { Diagnosis } from './entities/diagnosis.entity.js';
import { Prescription } from './entities/prescription.entity.js';

// keyof SoftDeletableEntity (not the old literal 'createdAt' | 'updatedAt'): these entities now also
// carry createdBy/updatedBy/deletedAt/deletedBy, all system-populated by AuditColumnsSubscriber,
// never part of a create/update input.
export type CreateNoteInput = Omit<ClinicalNote, 'id' | keyof SoftDeletableEntity | 'status'>;
export type UpdateNoteInput = Partial<Omit<ClinicalNote, 'id' | keyof SoftDeletableEntity | 'patientId' | 'doctorId' | 'appointmentId'>>;

export type CreateDiagnosisInput = Omit<Diagnosis, 'id' | keyof SoftDeletableEntity>;
export type CreatePrescriptionInput = Omit<Prescription, 'id' | keyof SoftDeletableEntity | 'status'>;

@Injectable()
export class EncountersService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  // --- Clinical Notes ---
  async createNote(input: CreateNoteInput): Promise<ClinicalNote> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(ClinicalNote);
      const note = repository.create(input);
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
      const diagnosis = repository.create(input);
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
      const prescription = repository.create(input);
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
