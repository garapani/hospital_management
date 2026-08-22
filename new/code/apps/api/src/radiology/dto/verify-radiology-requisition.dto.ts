import { IsOptional, IsString } from 'class-validator';

export class VerifyRadiologyRequisitionDto {
  @IsOptional()
  @IsString()
  verifiedBy?: string;
}
