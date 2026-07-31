export class UpdateVitalDto {
  height?: number; // cm
  weight?: number; // kg
  temperature?: number; // Celsius
  pulse?: number; // bpm
  bpSystolic?: number;
  bpDiastolic?: number;
  respiratoryRate?: number; // breaths per minute
  spO2?: number; // percentage
  painScale?: number; // 0-10 scale
  triageNotes?: string;
  recordedAt?: Date;
}
