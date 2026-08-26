import { IsOptional, IsString } from 'class-validator';

export class EnterReportDto {
  @IsString()
  reportText!: string;

  @IsOptional()
  @IsString()
  indication?: string;

  @IsOptional()
  @IsString()
  performerId?: string;

  @IsOptional()
  @IsString()
  reportEnteredBy?: string;
}
