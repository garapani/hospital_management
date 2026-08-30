import { IsNumber, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateRuleDto {
  @IsUUID()

  doctorId!: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsNumber()
  fractionPercent!: number;
}
