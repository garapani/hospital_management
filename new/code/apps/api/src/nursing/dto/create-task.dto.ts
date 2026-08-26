import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateTaskDto {
  @IsString()
  admissionId!: string;

  @IsString()
  taskType!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;
}
