import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  // Not trusted from the caller: the authenticated clinician's account (from the verified
  // JWT) wins. This is only a fallback for non-HTTP callers (service specs) that run without
  // a tenant context — see EncountersService.resolveActor.
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  historyOfPresentingIllness?: string;

  @IsOptional()
  @IsString()
  physicalExamination?: string;

  @IsOptional()
  @IsString()
  plan?: string;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  historyOfPresentingIllness?: string;

  @IsOptional()
  @IsString()
  physicalExamination?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateDiagnosisDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  // Not trusted from the caller — see CreateNoteDto.doctorId.
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  icd10Code?: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreatePrescriptionDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  // Not trusted from the caller — see CreateNoteDto.doctorId.
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsString()
  medicationName!: string;

  @IsString()
  dosage!: string;

  @IsString()
  frequency!: string;

  @IsString()
  route!: string;

  // int column — a negative/decimal value is nonsensical for a prescription's duration.
  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
