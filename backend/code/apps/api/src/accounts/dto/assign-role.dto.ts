import { IsDateString, IsOptional, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  roleName!: string;

  // Date strings only: the controller passes these to `new Date(...)`, and an arbitrary string
  // parses to Invalid Date, which TypeORM then sends to a timestamptz column as a raw Postgres
  // error (500) instead of a clean 400 (the codebase-wide malformed-input rule).
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
