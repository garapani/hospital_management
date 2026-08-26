import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRuleDto {
  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsNumber()
  fractionPercent!: number;
}
