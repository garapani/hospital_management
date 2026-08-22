import { IsOptional, IsString } from 'class-validator';

export class CreateAdmissionDto {
  @IsString()
  patientId!: string;

  @IsString()
  admissionSource!: string;

  @IsOptional()
  @IsString()
  sourceAppointmentId?: string;

  @IsOptional()
  @IsString()
  sourceTriageEntryId?: string;

  @IsString()
  admittingDoctorId!: string;

  @IsString()
  bedId!: string;
}
