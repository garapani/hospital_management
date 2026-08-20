export class CreateDischargeSummaryDto {
  admissionId!: string;
  patientId!: string;
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  proceduresPerformed?: string[];
  hospitalCourse?: string;
  dischargeMedications?: string;
  followUpInstructions?: string;
  warningSigns?: string;
  activityRestrictions?: string;
  followUpAppointmentDate?: string;
  followUpDoctorId?: string;
  dietRecommendations?: string;
  additionalNotes?: string;
  preparedBy?: string;
}

export class UpdateDischargeSummaryDto {
  primaryDiagnosis?: string;
  secondaryDiagnoses?: string[];
  proceduresPerformed?: string[];
  hospitalCourse?: string;
  dischargeMedications?: string;
  followUpInstructions?: string;
  warningSigns?: string;
  activityRestrictions?: string;
  followUpAppointmentDate?: string;
  followUpDoctorId?: string;
  dietRecommendations?: string;
  additionalNotes?: string;
  reviewedBy?: string;
}

export class ReviewDischargeSummaryDto {
  reviewedBy?: string;
}
