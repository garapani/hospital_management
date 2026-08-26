import { IsOptional, IsString } from 'class-validator';

export class MarkScannedDto {
  @IsOptional()
  @IsString()
  scannedBy?: string;
}
