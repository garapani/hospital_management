import { IsDateString, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class UpdateAppointmentDto {
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  // Same rules as the create DTO — '' or a malformed value must 400, not 500 on the date/time
  // columns.
  @IsOptional()
  @Matches(/^[0-9]{10}$/, { message: 'contactNumber must be a 10-digit number' })
  contactNumber?: string;

  @IsOptional()
  @IsDateString()
  appointmentDate?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, {
    message: 'appointmentTime must be a 24h time (HH:MM)',
  })
  appointmentTime?: string;

  @IsOptional()
  @IsUUID()
  doctorId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  appointmentType?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
