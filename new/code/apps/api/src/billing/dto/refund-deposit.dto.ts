export class RefundDepositDto {
  amount!: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  refundedBy?: string;
}
