import { IsString } from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

export class ChangeInitialPasswordDto {
  @IsString()
  username!: string;

  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}
