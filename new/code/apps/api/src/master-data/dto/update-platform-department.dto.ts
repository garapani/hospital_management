import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdatePlatformDepartmentDto {
  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  isAppointmentApplicable?: boolean;
}
