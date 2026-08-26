import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateMaternityRecordDto {
  @IsOptional()
  @IsNumber()
  gravida?: number;

  @IsOptional()
  @IsNumber()
  para?: number;

  @IsOptional()
  @IsDateString()
  lmp?: string;

  @IsOptional()
  @IsDateString()
  edd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
