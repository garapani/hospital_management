import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRadiologyImagingTypeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  procedureCoding?: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;
}
