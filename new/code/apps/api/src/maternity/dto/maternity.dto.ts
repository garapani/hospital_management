import { DeliveryType } from '../entities/maternity-record.entity.js';

export class CreateMaternityRecordDto {
  admissionId!: string;
  patientId!: string;
  gravida?: number;
  para?: number;
  lmp?: string;
  edd?: string;
  notes?: string;
}

export class UpdateMaternityRecordDto {
  gravida?: number;
  para?: number;
  lmp?: string;
  edd?: string;
  notes?: string;
}

export class RecordDeliveryDto {
  deliveryDate!: string;
  deliveryType!: DeliveryType;
  babyCount!: number;
  complications?: string;
  notes?: string;
}

export class ListMaternityRecordsQueryDto {
  patientId?: string;
  admissionId?: string;
}
