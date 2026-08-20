export class CreateStockRequisitionItemDto {
  itemId!: string;
  requestedQuantity!: number;
}

export class CreateStockRequisitionDto {
  departmentId!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  requestedBy?: string;
  notes?: string;
  items!: CreateStockRequisitionItemDto[];
}
