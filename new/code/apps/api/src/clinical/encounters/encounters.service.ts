import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantConnectionService } from '../../database/tenant-connection.service.js';
import { ClinicalNote } from './entities/clinical-note.entity.js';
import { Diagnosis } from './entities/diagnosis.entity.js';
import { Prescription } from './entities/prescription.entity.js';

export type CreateNoteInput = Omit<ClinicalNote, 'id' | 'createdAt' | 'updatedAt' | 'status'>;
export type UpdateNoteInput = Partial<Omit<ClinicalNote, 'id' | 'createdAt' | 'updatedAt' | 'patientId' | 'doctorId' | 'appointmentId'>>;

export type CreateDiagnosisInput = Omit<Diagnosis, 'id' | 'createdAt' | 'updatedAt'>;
export type CreatePrescriptionInput = Omit<Prescription, 'id' | 'createdAt' | 'updatedAt' | 'status'>;

export interface EncounterQueryParams {
  patientId: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

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

  async getNotesByPatient(params: EncounterQueryParams): Promise<PaginatedResult<ClinicalNote>> {
    const { patientId, page = 1, limit = 10 } = params;
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(ClinicalNote);
      const queryBuilder = repository.createQueryBuilder('note')
        .where('note.patientId = :patientId', { patientId })
        .orderBy('note.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);
      
      const [data, total] = await queryBuilder.getManyAndCount();
      
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
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
      await repository.remove(diagnosis);
    });
  }

  async getDiagnosesByPatient(params: EncounterQueryParams): Promise<PaginatedResult<Diagnosis>> {
    const { patientId, page = 1, limit = 10 } = params;
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Diagnosis);
      const queryBuilder = repository.createQueryBuilder('diagnosis')
        .where('diagnosis.patientId = :patientId', { patientId })
        .orderBy('diagnosis.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);
      
      const [data, total] = await queryBuilder.getManyAndCount();
      
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
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
      await repository.remove(prescription);
    });
  }

  async getPrescriptionsByPatient(params: EncounterQueryParams): Promise<PaginatedResult<Prescription>> {
    const { patientId, page = 1, limit = 10 } = params;
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Prescription);
      const queryBuilder = repository.createQueryBuilder('prescription')
        .where('prescription.patientId = :patientId', { patientId })
        .orderBy('prescription.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit);
      
      const [data, total] = await queryBuilder.getManyAndCount();
      
      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }
}
