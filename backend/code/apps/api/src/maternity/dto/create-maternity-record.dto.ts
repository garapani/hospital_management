import { IsDateString, IsNumber, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateMaternityRecordDto {
  @IsUUID()

  admissionId!: string;

  @IsUUID()

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
