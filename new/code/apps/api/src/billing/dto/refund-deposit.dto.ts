import { IsNumber, IsOptional, IsString } from 'class-validator';

export class RefundDepositDto {
  @IsNumber()
  amount!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  refundedBy?: string;
}
