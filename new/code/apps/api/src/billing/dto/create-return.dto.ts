import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReturnDto {
  @IsNumber()
  amount!: number;

  @IsString()
  reason!: string;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  returnedBy?: string;
}
