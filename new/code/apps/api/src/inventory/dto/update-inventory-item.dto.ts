export class UpdateInventoryItemDto {
  name?: string;
  code?: string;
  unitOfMeasure?: string;
  reorderLevel?: number;
  minimumStock?: number;
  salePrice?: number;
}
