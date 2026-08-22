import { IsOptional, IsString } from 'class-validator';

export class DispenseDrugDto {
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  @IsOptional()
  @IsString()
  dispensedBy?: string;
}
