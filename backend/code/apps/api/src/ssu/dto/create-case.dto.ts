import { IsNumber, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateCaseDto {
  @IsUUID()

  patientId!: string;

  @IsString()
  caseType!: string;

  @IsOptional()
  @IsString()
  eligibilityNotes?: string;

  @IsOptional()
  @IsNumber()
  subsidyPercent?: number;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  appliedBy?: string;
}
