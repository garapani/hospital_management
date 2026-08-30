import { IsDateString, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateSurgeryDto {
  @IsUUID()

  patientId!: string;

  @IsOptional()
  @IsString()
  admissionId?: string;

  @IsString()
  procedureName!: string;

  @IsOptional()
  @IsString()
  otRoom?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  surgeonId?: string;

  @IsOptional()
  @IsString()
  anesthesiologistId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
