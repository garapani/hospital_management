import { IsString } from 'class-validator';

export class LinkPatientDto {
  @IsString()
  patientId!: string;
}
