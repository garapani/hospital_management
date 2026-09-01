import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  historyOfPresentingIllness?: string;

  @IsOptional()
  @IsString()
  physicalExamination?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  // Only 'Signed' is a real transition a caller can request (a note starts 'Draft' and the
  // service itself rejects any further edit once 'Signed' — see EncountersService.updateNote).
  @IsOptional()
  @IsIn(['Draft', 'Signed'])
  status?: string;
}
