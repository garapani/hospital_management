export class CreateVitalDto {
  patientId!: string;
  appointmentId?: string;
  temperature?: number; // Celsius
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  heartRate?: number; // bpm
  respiratoryRate?: number; // breaths per minute
  oxygenSaturation?: number; // percentage
  weight?: number; // kg
  height?: number; // cm
  notes?: string;
}
