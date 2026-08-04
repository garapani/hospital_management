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

export interface RefreshInput {
  refreshToken: string;
}

export type RefreshResult =
  | { accessToken: string; refreshToken: string }
  | { invalidToken: true };

interface RefreshTokenPayload {
  sub: string;
  hospitalId: string;
  type: string;
}

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

    const { account, roleIds, roleNames } = found;

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
    const permissions = await this.accountsService.getPermissionNamesForRoles(roleIds);
    const payload = {
      sub: account.id,
      roles: roleNames,
      permissions,
      hospitalId,
      type: 'access' as const,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.jwtService.signAsync(
      { sub: account.id, hospitalId, type: 'refresh' as const },
      { expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken };
  }

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(input.refreshToken);
    } catch {
      return { invalidToken: true };
    }

    if (payload.type !== 'refresh') {
      return { invalidToken: true };
    }

    const found = await this.tenantContext.run(
      { tenantId: payload.hospitalId, correlationId: 'auth-refresh' },
      () => this.accountsService.getAccountWithRoles(payload.sub),
    );
    if (!found) {
      return { invalidToken: true };
    }

    const permissions = await this.accountsService.getPermissionNamesForRoles(found.roleIds);
    const accessPayload = {
      sub: found.account.id,
      roles: found.roleNames,
      permissions,
      hospitalId: payload.hospitalId,
      type: 'access' as const,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, { expiresIn: ACCESS_TOKEN_TTL });
    // Rotate: issue a new refresh token instead of letting the caller reuse the old one. This is
    // stateless rotation only — there is no revocation store in this codebase, so the previous
    // refresh token remains cryptographically valid until its own 7-day expiry rather than being
    // immediately invalidated (see the design spec for why this is an accepted limitation).
    const newRefreshToken = await this.jwtService.signAsync(
      { sub: found.account.id, hospitalId: payload.hospitalId, type: 'refresh' as const },
      { expiresIn: REFRESH_TOKEN_TTL },
    );
    return { accessToken, refreshToken: newRefreshToken };
  }
}
