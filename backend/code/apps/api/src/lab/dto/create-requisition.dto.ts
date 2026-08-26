import { IsString } from 'class-validator';

export class CreateRequisitionDto {
  @IsString()
  orderItemId!: string;

  @IsString()
  testId!: string;

  @IsString()
  specimenType!: string;
}
