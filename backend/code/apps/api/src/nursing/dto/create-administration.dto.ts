import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAdministrationDto {
  @IsUUID()

  admissionId!: string;

  @IsOptional()
  @IsUUID()
  prescriptionId?: string;

  @IsString()
  drugName!: string;

  @IsString()
  dose!: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
