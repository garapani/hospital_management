import { IsOptional, IsString } from 'class-validator';

export class CompleteSurgeryDto {
  @IsOptional()
  @IsString()
  postOpNotes?: string;
}
