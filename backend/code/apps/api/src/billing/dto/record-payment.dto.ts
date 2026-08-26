import { IsNumber, IsOptional, IsString } from 'class-validator';

export class RecordPaymentDto {
  @IsNumber()
  amount!: number;

  @IsString()
  paymentMode!: string;

  @IsOptional()
  @IsString()
  sourceDepositId?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  receivedBy?: string;
}
