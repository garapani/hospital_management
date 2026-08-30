import { IsUUID } from 'class-validator';

export class LinkPatientDto {
  // uuid column — the §107 write-path-uuid rule.
  @IsUUID()
  patientId!: string;
}
