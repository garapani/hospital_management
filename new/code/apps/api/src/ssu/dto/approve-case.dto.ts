import { IsOptional, IsString } from 'class-validator';

export class ApproveCaseDto {
  @IsOptional()
  @IsString()
  decisionNotes?: string;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  approvedBy?: string;
}
