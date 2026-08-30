import { IsArray, IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDischargeSummaryDto {
  // uuid/timestamptz columns — plain strings would 500 on the FK/date casts (§107 rule).
  @IsUUID()
  admissionId!: string;

  @IsUUID()
  patientId!: string;

  @IsOptional()
  @IsString()
  primaryDiagnosis?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryDiagnoses?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proceduresPerformed?: string[];

  @IsOptional()
  @IsString()
  hospitalCourse?: string;

  @IsOptional()
  @IsString()
  dischargeMedications?: string;

  @IsOptional()
  @IsString()
  followUpInstructions?: string;

  @IsOptional()
  @IsString()
  warningSigns?: string;

  @IsOptional()
  @IsString()
  activityRestrictions?: string;

  @IsOptional()
  @IsDateString()
  followUpAppointmentDate?: string;

  @IsOptional()
  @IsUUID()
  followUpDoctorId?: string;

  @IsOptional()
  @IsString()
  dietRecommendations?: string;

  @IsOptional()
  @IsString()
  additionalNotes?: string;

  @IsOptional()
  @IsString()
  preparedBy?: string;
}

export class UpdateDischargeSummaryDto {
  @IsOptional()
  @IsString()
  primaryDiagnosis?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryDiagnoses?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  proceduresPerformed?: string[];

  @IsOptional()
  @IsString()
  hospitalCourse?: string;

  @IsOptional()
  @IsString()
  dischargeMedications?: string;

  @IsOptional()
  @IsString()
  followUpInstructions?: string;

  @IsOptional()
  @IsString()
  warningSigns?: string;

  @IsOptional()
  @IsString()
  activityRestrictions?: string;

  @IsOptional()
  @IsDateString()
  followUpAppointmentDate?: string;

  @IsOptional()
  @IsUUID()
  followUpDoctorId?: string;

  @IsOptional()
  @IsString()
  dietRecommendations?: string;

  @IsOptional()
  @IsString()
  additionalNotes?: string;

  @IsOptional()
  @IsString()
  reviewedBy?: string;
}

export class ReviewDischargeSummaryDto {
  @IsOptional()
  @IsString()
  reviewedBy?: string;
}
