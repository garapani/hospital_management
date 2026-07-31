export class CreateTriageEntryDto {
  patientId?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
  estimatedAge?: string;
  arrivalMode?: string;
  broughtBy?: string;
  isPoliceCase?: boolean;
  chiefComplaint?: string;
  acuityLevel?: number;
  colorCode?: string;
  triagedBy?: string;
  triagedAt?: Date;
  status?: string;
  dischargeRemarks?: string;
}
