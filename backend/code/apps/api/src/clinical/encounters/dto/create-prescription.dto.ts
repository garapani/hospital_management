import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreatePrescriptionDto {
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
