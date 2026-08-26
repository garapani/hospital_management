import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateLabTestCategoryDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  displaySequence?: number;
}
