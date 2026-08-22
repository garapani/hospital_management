import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpdateLabTestDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  specimenType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}
