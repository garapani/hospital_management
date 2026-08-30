import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAdmissionDto {
  // uuid columns — plain strings would pass validation and turn a bad id into a raw 500 on the
  // FK (the §107 write-path-uuid rule; admissions was one of the modules the sweep missed).
  @IsUUID()
  patientId!: string;

  @IsString()
  admissionSource!: string;

  @IsOptional()
  @IsUUID()
  sourceAppointmentId?: string;

  @IsOptional()
  @IsUUID()
  sourceTriageEntryId?: string;

  @IsUUID()
  admittingDoctorId!: string;

  @IsUUID()
  bedId!: string;
}
