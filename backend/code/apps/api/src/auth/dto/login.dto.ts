import { IsString, MaxLength } from 'class-validator';

export class LoginDto {
  // Usernames are compared against varchar columns with no DB-side length bound — cap the input
  // so a multi-megabyte username can't ride the (throttled but cheap to produce) login path.
  @IsString()
  @MaxLength(255)
  username!: string;

  // 72 is bcrypt's byte limit — a longer password silently truncates on verify; an explicit
  // max length surfaces the mistake instead (code-review-findings-2026-08-25 auth P3).
  @IsString()
  @MaxLength(72)
  password!: string;
}

export class ChangeInitialPasswordDto {
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsString()
  currentPassword!: string;

  @IsString()
  @MaxLength(72)
  newPassword!: string;
}
