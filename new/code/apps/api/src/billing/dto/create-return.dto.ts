export class CreateReturnDto {
  amount!: number;
  reason!: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  returnedBy?: string;
}
