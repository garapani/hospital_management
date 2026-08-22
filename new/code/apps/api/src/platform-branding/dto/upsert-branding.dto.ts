import { IsOptional, IsString, MaxLength } from 'class-validator';

// `null` explicitly clears a field back to the default Vaidya brand; `undefined`/omitted leaves
// it unchanged. See PlatformBrandingService.upsertBranding.
export class UpsertBrandingDto {
  // The DB column is an unbounded varchar; this is displayed on the login page and every branding
  // read, so a server-side cap is the only thing stopping an accidental or malicious multi-MB value.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  primaryColor?: string | null;
}
