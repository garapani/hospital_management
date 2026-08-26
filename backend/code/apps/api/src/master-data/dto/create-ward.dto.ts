import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateWardDto {
  @IsString()
  wardCode!: string;

  @IsString()
  wardName!: string;

  @IsOptional()
  @IsString()
  wardType?: string;

  @IsOptional()
  @IsNumber()
  bedCapacity?: number;
}
