import { IsInt, IsOptional, IsString, Min } from 'class-validator';

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
