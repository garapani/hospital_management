export class CreateRadiologyImagingItemDto {
  imagingTypeId!: string;
  name!: string;
  procedureCode?: string;
  displaySequence?: number;
}
