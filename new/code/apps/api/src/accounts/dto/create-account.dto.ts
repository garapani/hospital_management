export class CreateAccountDto {
  username!: string;
  email!: string;
  displayName!: string;
  /** Optional initial password — the backend generates one (returned once) when omitted. */
  password?: string;
  roleName!: string;
}

export class ChangeOwnPasswordDto {
  currentPassword!: string;
  newPassword!: string;
}

export class ResetPasswordDto {
  /** Optional temporary password; when omitted the backend generates one (returned once). */
  password?: string;
}
