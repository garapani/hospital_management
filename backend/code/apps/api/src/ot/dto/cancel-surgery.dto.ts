import { IsOptional, IsString } from 'class-validator';

export class CancelSurgeryDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
