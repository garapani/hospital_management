import { IsIn, IsOptional, IsString } from 'class-validator';
import type { SterilizationMethod } from '../entities/cssd.entity.js';

export class StartCycleDto {
  @IsString()
  instrumentId!: string;

  @IsIn(['Steam', 'ETO', 'Chemical'])
  method!: SterilizationMethod;

  /** Deprecated — ignored when a tenant context with an accountId is active (see §25). */
  @IsOptional()
  @IsString()
  operatedBy?: string;
}
