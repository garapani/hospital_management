import { IsNotEmpty, IsString } from 'class-validator';

export class CancelAppointmentDto {
  @IsString()
  @IsNotEmpty()
  cancelledRemarks!: string;
}
