import { IsOptional, IsString } from 'class-validator';

export class CollectSampleDto {
  @IsOptional()
  @IsString()
  sampleCollectedBy?: string;
}
