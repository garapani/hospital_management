import { IsOptional, IsString } from 'class-validator';

export class MarkPaidDto {
  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  processedBy?: string;
}
