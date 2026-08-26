import { IsOptional, IsString } from 'class-validator';

export class CompleteOrderItemDto {
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  completedBy?: string;
}
