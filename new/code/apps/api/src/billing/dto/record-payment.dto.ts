export class RecordPaymentDto {
  amount!: number;
  paymentMode!: string;
  sourceDepositId?: string;
  receivedBy!: string;
}
