export class LoginDto {
  username!: string;
  password!: string;
}

export class ChangeInitialPasswordDto {
  username!: string;
  currentPassword!: string;
  newPassword!: string;
}
