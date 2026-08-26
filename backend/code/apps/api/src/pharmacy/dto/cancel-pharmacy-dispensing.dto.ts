import { IsOptional, IsString } from 'class-validator';

export class CancelPharmacyDispensingDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
