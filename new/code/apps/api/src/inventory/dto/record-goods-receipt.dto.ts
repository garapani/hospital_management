export class RecordGoodsReceiptDto {
  batchNumber!: string;
  expiryDate?: string;
  unitCost!: number;
  mrp?: number;
  receivedQuantity!: number;
  recordedBy?: string;
}
