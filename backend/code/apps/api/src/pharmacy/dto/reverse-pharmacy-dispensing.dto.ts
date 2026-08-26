import { IsOptional, IsString } from 'class-validator';

export class ReversePharmacyDispensingDto {
  @IsOptional()
  @IsString()
  reversalReason?: string;
}
