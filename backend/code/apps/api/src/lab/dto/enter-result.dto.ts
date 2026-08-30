import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class EnterResultDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
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
