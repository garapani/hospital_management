import { IsOptional, IsString } from 'class-validator';

export class CreateBedDto {
  @IsString()
  bedNumber!: string;

  @IsOptional()
  @IsString()
  bedType?: string;
}
