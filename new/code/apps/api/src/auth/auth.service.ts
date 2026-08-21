import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

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
  | { invalidCredentials: true }
  | { mustChangePassword: true }
  | { tenantInactive: true; reason: 'suspended' | 'archived' };

export interface RefreshInput {
  refreshToken: string;
}

export type RefreshResult =
  | { accessToken: string; refreshToken: string }
  | { invalidToken: true };

interface RefreshTokenPayload {
  sub: string;
  hospitalId: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
    private readonly packagesService: PackagesService,
    private readonly tenantsService: TenantsService,
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

    // A suspended or archived hospital cannot log in at all — credentials are verified first so
    // the tenant state is not leaked to a wrong-password attempt. Registry-gated (test tenants
    // without a registry row fail open, like the role-membership checks). The platform tenant is
    // always active.
    const hospitalId = this.tenantContext.getTenantId();
    if (hospitalId) {
      const tenantStatus = await this.tenantsService.getTenantStatus(hospitalId);
      if (tenantStatus === 'suspended' || tenantStatus === 'archived') {
        return { tenantInactive: true, reason: tenantStatus };
      }
    }

    // A freshly created account with an initial/generated password has no full access until it
    // replaces it — otherwise a known or generated-but-shared password would be a standing
    // backdoor. No tokens are issued; the client routes to the change-password flow.
    if (account.needsPasswordUpdate) {
      return { mustChangePassword: true };
    }

    // Package-scoped: only permissions whose modules are in the tenant's package reach the JWT,
    // so out-of-package features 403 and never render in the console.
    const permissions = await this.packagesService.filterPermissions(
      hospitalId,
      await this.accountsService.getPermissionNamesForRoles(roleIds),
    );
    const payload = this.buildAccessPayload(account.id, roleNames, permissions, hospitalId);

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.jwtService.signAsync(
      { sub: account.id, hospitalId, type: 'refresh' as const },
      { expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Onboarding password change for an account flagged `needsPasswordUpdate` (login with an
   * initial/generated password). Deliberately unauthenticated: login issues no tokens for such
   * accounts, so the client proves ownership with username + current password — the same
   * credential check login performs. Strictly gated to the must-change state; regular rotation
   * goes through the authenticated POST /accounts/me/password.
   */
  async changeInitialPassword(
    username: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const found = await this.accountsService.findByUsernameWithRoles(username);
    if (!found) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!found.account.needsPasswordUpdate) {
      throw new BadRequestException('This account is not required to change its password');
    }
    await this.accountsService.changePasswordByUsername(
      username,
      currentPassword,
      newPassword,
    );
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

    if (!found.account.isActive || (found.account.lockedUntil && found.account.lockedUntil.getTime() > Date.now())) {
      return { invalidToken: true };
    }

    // An account that must change its password cannot refresh into full access — the refresh
    // token predates the change and would otherwise bypass the login-time gate.
    if (found.account.needsPasswordUpdate) {
      return { invalidToken: true };
    }

    // Same tenant-status gate as login: a suspended/archived hospital cannot refresh either,
    // otherwise an existing session would keep working after suspension.
    const tenantStatus = await this.tenantsService.getTenantStatus(payload.hospitalId);
    if (tenantStatus === 'suspended' || tenantStatus === 'archived') {
      return { invalidToken: true };
    }

    const permissions = await this.packagesService.filterPermissions(
      payload.hospitalId,
      await this.accountsService.getPermissionNamesForRoles(found.roleIds),
    );
    const accessPayload = this.buildAccessPayload(
      found.account.id,
      found.roleNames,
      permissions,
      payload.hospitalId,
    );

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

  private buildAccessPayload(
    accountId: string,
    roles: string[],
    permissions: string[],
    hospitalId: string | undefined,
  ) {
    return {
      sub: accountId,
      roles,
      permissions,
      hospitalId,
      type: 'access' as const,
    };
  }
}
