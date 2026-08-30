import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CreateAppointmentDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  // Matches the patients module's phone rule — a malformed contact is data the front desk can't
  // reach back on.
  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{10}$/, { message: 'contactNumber must be a 10-digit number' })
  contactNumber!: string;

  // The entity column is a Postgres `date` — an arbitrary string would 500 on insert/query
  // instead of a clean 400 (the F5 validation gap, still live in this form).
  @IsDateString()
  appointmentDate!: string;

  // The entity column is a Postgres `time` — accept 'HH:MM' (optionally ':SS').
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'appointmentTime must be a 24h time (HH:MM)',
  })
  appointmentTime!: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsString()
  @IsNotEmpty()
  appointmentType!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
