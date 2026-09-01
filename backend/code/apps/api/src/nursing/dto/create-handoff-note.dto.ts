import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateHandoffNoteDto {
  @IsUUID()
  admissionId!: string;

  @IsOptional()
  @IsIn(['Day', 'Evening', 'Night'])
  shift?: string;

  @IsString()
  note!: string;
}
