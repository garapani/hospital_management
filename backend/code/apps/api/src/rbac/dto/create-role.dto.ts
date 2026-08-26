import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  name!: string;

  @IsString()
  description!: string;

  @IsNumber()
  priority!: number;

  @IsOptional()
  @IsBoolean()
  isCrossTenant?: boolean;
}
