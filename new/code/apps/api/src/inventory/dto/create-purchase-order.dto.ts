export class CreatePurchaseOrderItemDto {
  itemId!: string;
  orderedQuantity!: number;
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  vendorId!: string;
  orderedBy?: string;
  notes?: string;
  items!: CreatePurchaseOrderItemDto[];
}
