import { IsString } from 'class-validator';

export class CreateFixedAssetCategoryDto {
  @IsString()
  name!: string;
}
