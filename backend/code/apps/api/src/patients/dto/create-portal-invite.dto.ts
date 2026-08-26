import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePortalInviteDto {
  @IsString()
  @IsNotEmpty()
  username!: string;

  /** Falls back to the patient record's own email when omitted. */
  @IsOptional()
  @IsEmail()
  email?: string;
}
