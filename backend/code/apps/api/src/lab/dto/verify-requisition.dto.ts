import { IsOptional, IsString } from 'class-validator';

export class VerifyRequisitionDto {
  @IsOptional()
  @IsString()
  verifiedBy?: string;
}
