import { IsOptional, IsString } from 'class-validator';

export class CancelRequisitionDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
