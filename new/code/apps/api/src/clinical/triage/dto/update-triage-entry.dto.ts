import { IsBoolean, IsDate, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateTriageEntryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  estimatedAge?: string;

  @IsOptional()
  @IsString()
  arrivalMode?: string;

  @IsOptional()
  @IsString()
  broughtBy?: string;

  @IsOptional()
  @IsBoolean()
  isPoliceCase?: boolean;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  // int column (ESI scale) sorted ASC to drive the live ED queue's urgency order
  // (triage.service.ts:112) — a negative/zero/decimal value would sort ahead of a real ESI-1
  // patient or splice between real levels, corrupting queue ordering.
  @IsOptional()
  @IsInt()
  @Min(1)
  acuityLevel?: number;

  @IsOptional()
  @IsString()
  colorCode?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  triagedBy?: string;

  @IsOptional()
  @IsDate()
  triagedAt?: Date;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  dischargeRemarks?: string;
}
