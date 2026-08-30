import { IsString, IsUUID } from 'class-validator';

export class CreateRequisitionDto {
  // uuid columns — the §107 write-path-uuid rule.
  @IsUUID()
  orderItemId!: string;

  @IsUUID()
  testId!: string;

  @IsString()
  specimenType!: string;
}
