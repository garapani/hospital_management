export class CreateStockRequisitionItemDto {
  itemId!: string;
  requestedQuantity!: number;
}

export class CreateStockRequisitionDto {
  departmentId!: string;
  requestedBy!: string;
  notes?: string;
  items!: CreateStockRequisitionItemDto[];
}
