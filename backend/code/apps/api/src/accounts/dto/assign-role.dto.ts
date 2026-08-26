import { IsOptional, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  roleName!: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}
