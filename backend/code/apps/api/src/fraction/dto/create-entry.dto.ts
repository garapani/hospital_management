import { IsOptional, IsString } from 'class-validator';

export class CreateEntryDto {
  @IsString()
  invoiceId!: string;

  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  recordedBy?: string;
}
