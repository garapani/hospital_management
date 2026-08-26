import { IsOptional, IsString } from 'class-validator';

export class CancelRadiologyRequisitionDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
