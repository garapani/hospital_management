import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLabTestDto {
  @IsString()
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
