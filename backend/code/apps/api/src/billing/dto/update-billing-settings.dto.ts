import { IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdateBillingSettingsDto {
  @IsString()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, {
    message: 'gstin must be a valid 15-character GSTIN',
  })
  gstin!: string;

  @IsString()
  @Matches(/^\d{2}$/, { message: 'stateCode must be a 2-digit GST state code' })
  stateCode!: string;

  @IsString()
  hospitalLegalName!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultTaxPercent?: number;
}
