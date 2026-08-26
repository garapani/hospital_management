import { IsBoolean, IsString, ValidateIf } from 'class-validator';

export class CreatePlatformDepartmentDto {
  @IsString()
  departmentCode!: string;

  @IsString()
  departmentName!: string;

  @ValidateIf((_object, value) => value !== null)
  @IsString()
  description!: string | null;

  @IsBoolean()
  isAppointmentApplicable!: boolean;
}
