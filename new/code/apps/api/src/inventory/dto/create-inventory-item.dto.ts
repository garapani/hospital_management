export class CreateInventoryItemDto {
  subCategoryId!: string;
  name!: string;
  code!: string;
  unitOfMeasure!: string;
  reorderLevel?: number;
  minimumStock?: number;
}
