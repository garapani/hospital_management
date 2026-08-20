export class FulfillRequisitionItemDto {
  quantity!: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  fulfilledBy?: string;
}
