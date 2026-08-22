import { IsString } from 'class-validator';

export class UpdateBillingSettingsDto {
  @IsString()
  gstin!: string;

  @IsString()
  stateCode!: string;

  @IsString()
  hospitalLegalName!: string;
}
