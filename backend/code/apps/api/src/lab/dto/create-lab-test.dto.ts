import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLabTestDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
  categoryId!: string;

  @IsString()
  name!: string;

  @IsString()
  code!: string;

  @IsString()
  specimenType!: string;

  @IsOptional()
  @IsNumber()
  price?: number;
}
