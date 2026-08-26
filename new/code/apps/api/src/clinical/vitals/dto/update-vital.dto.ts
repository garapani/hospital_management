import { IsDate, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateVitalDto {
  // Bounds mirror CreateVitalDto — see its comment for why these specific ranges.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(300)
  height?: number; // cm

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  weight?: number; // kg

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(45)
  temperature?: number; // Celsius

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  pulse?: number; // bpm

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  bpSystolic?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  bpDiastolic?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  respiratoryRate?: number; // breaths per minute

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  spO2?: number; // percentage

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScale?: number; // 0-10 scale

  @IsOptional()
  @IsString()
  triageNotes?: string;

  @IsOptional()
  @IsDate()
  recordedAt?: Date;
}
