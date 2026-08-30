import { IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateEntryDto {
  @IsUUID()

  invoiceId!: string;

  @IsUUID()

  doctorId!: string;

  @IsOptional()
  @IsString()
  ruleId?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  recordedBy?: string;
}
