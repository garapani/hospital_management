import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateMaternityRecordDto {
  @IsString()
  admissionId!: string;

  @IsString()
  patientId!: string;

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
