import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CompleteCycleDto {
  @IsNumber()
  sterileHours!: number;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  operatedBy?: string;
}
