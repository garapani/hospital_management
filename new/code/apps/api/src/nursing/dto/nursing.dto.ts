import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '@hospital/pagination';

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

export class ListTasksQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
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

export class ListAdministrationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  admissionId?: string;
}

export class SkipAdministrationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
