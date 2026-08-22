// `null` explicitly clears a field back to the default Vaidya brand; `undefined`/omitted leaves
// it unchanged. See PlatformBrandingService.upsertBranding.
export class UpsertBrandingDto {
  displayName?: string | null;
  primaryColor?: string | null;
}
