import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  // 72 is bcrypt's byte limit — a longer password silently truncates on verify; an explicit
  // max length surfaces the mistake instead (code-review-findings-2026-08-25 auth P3).
  @IsString()
  @MaxLength(72)
  password!: string;
}

export class ChangeInitialPasswordDto {
  @IsString()
  username!: string;

  @IsString()
  currentPassword!: string;

  @IsString()
  @MaxLength(72)
  newPassword!: string;
}
