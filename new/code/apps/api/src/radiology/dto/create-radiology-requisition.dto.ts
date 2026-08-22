import { IsString } from 'class-validator';

export class CreateRadiologyRequisitionDto {
  @IsString()
  orderItemId!: string;

  @IsString()
  imagingItemId!: string;
}
