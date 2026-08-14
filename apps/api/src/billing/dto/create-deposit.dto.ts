export class CreateDepositDto {
  patientId!: string;
  amount!: number;
  receivedBy!: string;
  notes?: string;
}
