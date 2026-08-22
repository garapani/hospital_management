import { IsOptional, IsString } from 'class-validator';

export class DischargeAdmissionDto {
  @IsOptional()
  @IsString()
  dischargedBy?: string;

  @IsOptional()
  @IsString()
  dischargeType?: string;

  @IsOptional()
  @IsString()
  dischargeCondition?: string;

  @IsOptional()
  @IsString()
  dischargeSummary?: string;
}
