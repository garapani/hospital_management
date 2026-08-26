import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  departmentCode!: string;

  @IsString()
  departmentName!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isAppointmentApplicable?: boolean;

  // uuid column — a plain string here would turn a bad parent id into a raw 500 on the FK
  // (code-review-findings-2026-08-25 platform cross-cutting P3).
  @IsOptional()
  @IsUUID()
  parentDepartmentId?: string;

  @IsOptional()
  @IsString()
  roomNumber?: string;

  @IsOptional()
  @IsString()
  noticeText?: string;
}
