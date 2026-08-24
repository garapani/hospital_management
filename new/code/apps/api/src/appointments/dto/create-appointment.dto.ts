import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

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

  @IsString()
  @IsNotEmpty()
  contactNumber!: string;

  @IsString()
  @IsNotEmpty()
  appointmentDate!: string;

  @IsString()
  @IsNotEmpty()
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
