import { IsOptional, IsString } from 'class-validator';

export class SkipAdministrationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
