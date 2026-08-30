import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDiagnosisDto {
  // uuid columns — the §107 write-path-uuid rule.
  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  // Not trusted from the caller — see CreateNoteDto.doctorId.
  @IsOptional()
  @IsUUID()
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
