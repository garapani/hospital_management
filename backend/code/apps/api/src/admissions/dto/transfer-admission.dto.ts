import { IsOptional, IsString } from 'class-validator';

export class TransferAdmissionDto {
  @IsString()
  toBedId!: string;

  @IsOptional()
  @IsString()
  transferredBy?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
