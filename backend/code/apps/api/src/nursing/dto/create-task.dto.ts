import { IsDateString, IsOptional, IsString, IsUUID} from 'class-validator';

export class CreateTaskDto {
  @IsUUID()

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
