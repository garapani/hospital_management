import { IsString } from 'class-validator';

export class PurgeTenantDto {
  /** Must exactly match the :hospitalId path param — typed confirmation for an irreversible op. */
  @IsString()
  confirmHospitalId!: string;
}
