export class CreateDepositDto {
  patientId!: string;
  amount!: number;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  receivedBy?: string;
  notes?: string;
}
