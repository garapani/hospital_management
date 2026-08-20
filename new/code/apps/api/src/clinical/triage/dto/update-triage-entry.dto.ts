export class UpdateTriageEntryDto {
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
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  triagedBy?: string;
  triagedAt?: Date;
  status?: string;
  dischargeRemarks?: string;
}
