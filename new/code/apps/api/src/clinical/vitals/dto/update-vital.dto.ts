import { IsDate, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateVitalDto {
  @IsOptional()
  @IsNumber()
  height?: number; // cm

  @IsOptional()
  @IsNumber()
  weight?: number; // kg

  @IsOptional()
  @IsNumber()
  temperature?: number; // Celsius

  @IsOptional()
  @IsNumber()
  pulse?: number; // bpm

  @IsOptional()
  @IsNumber()
  bpSystolic?: number;

  @IsOptional()
  @IsNumber()
  bpDiastolic?: number;

  @IsOptional()
  @IsNumber()
  respiratoryRate?: number; // breaths per minute

  @IsOptional()
  @IsNumber()
  spO2?: number; // percentage

  @IsOptional()
  @IsNumber()
  painScale?: number; // 0-10 scale

  @IsOptional()
  @IsString()
  triageNotes?: string;

  @IsOptional()
  @IsDate()
  recordedAt?: Date;
}
