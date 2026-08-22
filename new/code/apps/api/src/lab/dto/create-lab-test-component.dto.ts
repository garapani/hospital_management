import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLabTestComponentDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  referenceRangeLow?: number;

  @IsOptional()
  @IsNumber()
  referenceRangeHigh?: number;

  @IsOptional()
  @IsString()
  referenceRangeText?: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;
}
