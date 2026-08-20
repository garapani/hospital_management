export class UpdateRadiologyImagingItemDto {
  name?: string;
  procedureCode?: string;
  displaySequence?: number;
  /** Selling price in INR; null = not priced yet. */
  price?: number;
}
