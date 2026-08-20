export class RecordPaymentDto {
  amount!: number;
  paymentMode!: string;
  sourceDepositId?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  receivedBy?: string;
}
