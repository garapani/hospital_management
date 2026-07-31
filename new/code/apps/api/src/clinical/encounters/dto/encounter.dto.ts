export class CreateNoteDto {
  patientId!: string;
  appointmentId?: string;
  doctorId!: string;
  chiefComplaint?: string;
  historyOfPresentingIllness?: string;
  physicalExamination?: string;
  plan?: string;
}

export class UpdateNoteDto {
  chiefComplaint?: string;
  historyOfPresentingIllness?: string;
  physicalExamination?: string;
  plan?: string;
  status?: string;
}

export class CreateDiagnosisDto {
  patientId!: string;
  appointmentId?: string;
  doctorId!: string;
  icd10Code?: string;
  description!: string;
  isPrimary?: boolean;
}

export class CreatePrescriptionDto {
  patientId!: string;
  appointmentId?: string;
  doctorId!: string;
  medicationName!: string;
  dosage!: string;
  frequency!: string;
  route!: string;
  durationDays!: number;
  notes?: string;
}
