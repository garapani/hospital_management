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

export class ListTasksQueryDto {
  @IsOptional()
  @IsString()
  admissionId?: string;
}

export class CreateAdministrationDto {
  @IsString()
  admissionId!: string;

  @IsString()
  drugName!: string;

  @IsString()
  dose!: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListAdministrationsQueryDto {
  @IsOptional()
  @IsString()
  admissionId?: string;
}

export class SkipAdministrationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
