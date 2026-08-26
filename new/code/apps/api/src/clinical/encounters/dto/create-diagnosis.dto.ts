import { IsBoolean, IsOptional, IsString } from 'class-validator';

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
