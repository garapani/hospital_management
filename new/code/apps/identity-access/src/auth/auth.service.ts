import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface LoginInput {
  username: string;
  password: string;
}

export type LoginResult =
  | { accessToken: string; refreshToken: string }
  | { locked: true; retryAfterSeconds: number }
  | { invalidCredentials: true };

@Injectable()
export class AuthService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const found = await this.accountsService.findByUsernameWithRoles(input.username);
    if (!found) {
      return { invalidCredentials: true };
    }

    const { account, roleNames } = found;

    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 1000);
      return { locked: true, retryAfterSeconds };
    }

    const passwordMatches =
      account.passwordHash !== null && (await bcrypt.compare(input.password, account.passwordHash));

    if (!passwordMatches) {
      await this.accountsService.recordFailedLogin(account.id);
      const updatedAttempts = account.failedLoginAttempts + 1;
      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.accountsService.lockAccount(account.id, new Date(Date.now() + LOCKOUT_DURATION_MS));
      }
      return { invalidCredentials: true };
    }

    await this.accountsService.resetFailedLogins(account.id);

    const hospitalId = this.tenantContext.getTenantId();
    const payload = {
      sub: account.id,
      roles: roleNames,
      permissions: [] as string[],
      hospitalId,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.jwtService.signAsync(
      { sub: account.id, hospitalId },
      { expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken };
  }
}
