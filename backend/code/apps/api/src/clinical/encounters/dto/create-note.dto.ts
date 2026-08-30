import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateNoteDto {
  // uuid columns — the §107 write-path-uuid rule.
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  // Not trusted from the caller: the authenticated clinician's account (from the verified
  // JWT) wins. This is only a fallback for non-HTTP callers (service specs) that run without
  // a tenant context — see EncountersService.resolveActor.
  @IsOptional()
  @IsUUID()
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
