import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateDischargeSummaryDto {
  @IsString()
  admissionId!: string;

  @IsString()
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
  @IsString()
  followUpAppointmentDate?: string;

  @IsOptional()
  @IsString()
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
  @IsString()
  followUpAppointmentDate?: string;

  @IsOptional()
  @IsString()
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
