import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDepositDto {
  @IsString()
  patientId!: string;

  @IsNumber()
  amount!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  receivedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
