import { IsNumber, IsOptional, IsString } from 'class-validator';

export class FulfillRequisitionItemDto {
  @IsNumber()
  quantity!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  fulfilledBy?: string;
}
