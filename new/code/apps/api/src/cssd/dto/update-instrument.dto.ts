import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateInstrumentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  category?: string;

  // int column, default 0 — a negative/decimal value would corrupt sterile-instrument-set counts.
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}
