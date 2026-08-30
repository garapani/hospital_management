import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  @MaxLength(255)
  username!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(255)
  displayName!: string;

  // @IsNotEmpty (not just @IsString): createStaffAccount's `input.password ?? generatedPassword`
  // (accounts.service.ts:122-123) only falls back on null/undefined, not "" — an empty string
  // here would silently create the account with an empty password instead of a generated one.
  /** Optional initial password — the backend generates one (returned once) when omitted. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(72) // bcrypt's byte limit — longer values silently truncate on verify (auth P3 rule)
  password?: string;

  @IsString()
  roleName!: string;
}

export class ChangeOwnPasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword!: string;

  @IsString()
  @MaxLength(72)
  newPassword!: string;
}

export class ResetPasswordDto {
  // Same empty-string gap as CreateAccountDto.password — resetPassword's `password ??
  // generatedPassword` (accounts.service.ts:392-393) doesn't catch "".
  /** Optional temporary password; when omitted the backend generates one (returned once). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(72)
  password?: string;
}
