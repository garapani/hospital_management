import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class OpenShiftDto {
  @IsNumber()
  @Min(0)
  floatAmount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
