import { OtSurgeryStatus } from '../entities/ot-surgery.entity.js';

export class CreateSurgeryDto {
  patientId!: string;
  admissionId?: string;
  procedureName!: string;
  otRoom?: string;
  scheduledAt?: string;
  surgeonId?: string;
  anesthesiologistId?: string;
  notes?: string;
}

export class ListSurgeriesQueryDto {
  page?: number;
  limit?: number;
  status?: OtSurgeryStatus;
  patientId?: string;
}
