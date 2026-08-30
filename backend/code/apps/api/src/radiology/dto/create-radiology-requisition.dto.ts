import { IsUUID } from 'class-validator';

export class CreateRadiologyRequisitionDto {
  // uuid columns — the §107 write-path-uuid rule.
  @IsUUID()
  orderItemId!: string;

  @IsUUID()
  imagingItemId!: string;
}
