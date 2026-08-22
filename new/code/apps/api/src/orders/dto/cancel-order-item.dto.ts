import { IsOptional, IsString } from 'class-validator';

export class CancelOrderItemDto {
  @IsOptional()
  @IsString()
  cancelReason?: string;
}
