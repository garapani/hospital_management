import { IsOptional, IsString } from 'class-validator';

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
