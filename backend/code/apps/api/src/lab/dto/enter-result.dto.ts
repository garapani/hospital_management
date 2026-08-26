import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class EnterResultDto {
  @IsString()
  componentId!: string;

  @IsString()
  value!: string;

  @IsOptional()
  @IsBoolean()
  isAbnormal?: boolean;

  @IsOptional()
  @IsString()
  enteredBy?: string;
}
