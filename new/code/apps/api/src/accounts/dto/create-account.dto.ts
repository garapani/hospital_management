import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAccountDto {
  @IsString()
  username!: string;

  @IsString()
  email!: string;

  @IsString()
  displayName!: string;

  // @IsNotEmpty (not just @IsString): createStaffAccount's `input.password ?? generatedPassword`
  // (accounts.service.ts:122-123) only falls back on null/undefined, not "" — an empty string
  // here would silently create the account with an empty password instead of a generated one.
  /** Optional initial password — the backend generates one (returned once) when omitted. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;

  @IsString()
  roleName!: string;
}

export class ChangeOwnPasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  newPassword!: string;
}

export class ResetPasswordDto {
  // Same empty-string gap as CreateAccountDto.password — resetPassword's `password ??
  // generatedPassword` (accounts.service.ts:392-393) doesn't catch "".
  /** Optional temporary password; when omitted the backend generates one (returned once). */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  password?: string;
}
