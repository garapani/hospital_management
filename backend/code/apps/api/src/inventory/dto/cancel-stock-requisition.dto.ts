import { IsOptional, IsString } from 'class-validator';

export class CancelStockRequisitionDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
