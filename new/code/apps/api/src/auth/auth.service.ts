import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
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
  | { tenantInactive: true; reason: 'suspended' | 'archived' | 'purged' };

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
    private readonly packagesService: PackagesService,
    private readonly tenantsService: TenantsService,
  ) {}

  /**
   * Enforces the tenant status gate for authentication operations. A suspended, archived, or
   * purged hospital cannot log in, refresh, or change their initial password. Test tenants
   * without a registry row fail open. The platform tenant is always active (getTenant returns
   * null).
   *
   * Allowlist of exactly 'active', not a denylist: unlike `TenantsService.
   * assertValidHospitalTenant(hospitalId, ['active', 'suspended'], ...)` (billing/branding
   * operations correctly continue during suspension, only archived/purged block them), a
   * suspended tenant must NOT be able to log in — suspension blocking login is the whole point of
   * the status. Rejecting everything except 'active' means a future new status value is rejected
   * by default here too, not silently let through the way the old suspended/archived-only denylist
   * let 'purged' through unnoticed when that status was added.
   */
  private async checkTenantStatusGate(hospitalId: string | undefined): Promise<{ packageCode: string | null } | { tenantInactive: true; reason: 'suspended' | 'archived' | 'purged' }> {
    const tenant = hospitalId ? await this.tenantsService.getTenant(hospitalId) : null;
    if (hospitalId && tenant && tenant.status !== 'active') {
      return { tenantInactive: true, reason: tenant.status };
    }
    return { packageCode: tenant?.packageCode ?? null };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    // A purged tenant's schema/role are dropped (TenantsService.purgeTenant), so this lookup
    // fails inside runInTenantSchema's `SET LOCAL ROLE` with a raw Postgres error — same root
    // cause as 2.23's refresh() fix. Unlike refresh(), the caught failure is folded into
    // invalidCredentials here rather than a distinct outcome: login()'s status gate is
    // deliberately placed after credential verification specifically so tenant state is never
    // leaked to an unauthenticated caller (see the comment below), and a purged-tenant lookup
    // failure must preserve that same anti-enumeration property, not announce itself differently
    // from a wrong password.
    let found: Awaited<ReturnType<AccountsService['findByUsernameWithRoles']>>;
    try {
      found = await this.accountsService.findByUsernameWithRoles(input.username);
    } catch (err) {
      // Logged, not swallowed silently: this catch is meant for one specific, expected cause (a
      // purged tenant), but it's unscoped by necessity (the response must not distinguish a
      // purged tenant from a wrong password). A genuine infrastructure fault here — a connection
      // pool exhausted, an unrelated query bug — would otherwise be indistinguishable from normal
      // failed-login traffic in monitoring, with no trace to diagnose it from.
      this.logger.warn(
        `login() account lookup failed for username "${input.username}" — treating as invalid credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { invalidCredentials: true };
    }
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
    // the tenant state is not leaked to a wrong-password attempt.
    const hospitalId = this.tenantContext.getTenantId();
    const statusGate = await this.checkTenantStatusGate(hospitalId);
    if ('tenantInactive' in statusGate) {
      return statusGate;
    }

    // A freshly created account with an initial/generated password has no full access until it
    // replaces it — otherwise a known or generated-but-shared password would be a standing
    // backdoor. No tokens are issued; the client routes to the change-password flow.
    if (account.needsPasswordUpdate) {
      return { mustChangePassword: true };
    }

    const permissions = await this.packagesService.filterPermissions(
      hospitalId,
      await this.accountsService.getPermissionNamesForRoles(roleIds),
      statusGate.packageCode,
    );
    const payload = this.buildAccessPayload(
      account.id,
      roleNames,
      permissions,
      hospitalId,
      account.accountType,
      account.patientId,
    );

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
    // Same purged-tenant schema-access failure as login() above — folded into the same
    // Invalid-credentials outcome the existing !found branch already uses.
    let found: Awaited<ReturnType<AccountsService['findByUsernameWithRoles']>>;
    try {
      found = await this.accountsService.findByUsernameWithRoles(username);
    } catch (err) {
      this.logger.warn(
        `changeInitialPassword() account lookup failed for username "${username}" — treating as invalid credentials: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    // Credentials are verified before anything else about the account's state is revealed — same
    // reasoning as login()'s status-gate placement above. This endpoint is deliberately
    // unauthenticated, so a distinct response for "unknown username" vs. "known username, already
    // past the must-change state" (formerly checked here before any password comparison) would let
    // a caller enumerate valid usernames without ever supplying a correct password.
    const passwordMatches =
      !!found &&
      found.account.passwordHash !== null &&
      (await bcrypt.compare(currentPassword, found.account.passwordHash));
    if (!found || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!found.account.needsPasswordUpdate) {
      throw new BadRequestException('This account is not required to change its password');
    }

    const hospitalId = this.tenantContext.getTenantId();
    const statusGate = await this.checkTenantStatusGate(hospitalId);
    if ('tenantInactive' in statusGate) {
      throw new UnauthorizedException(`Tenant is ${statusGate.reason}`);
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

    // A purged tenant's schema/role are dropped (TenantsService.purgeTenant), so resolving the
    // account below fails inside runInTenantSchema's `SET LOCAL ROLE` with a raw "role does not
    // exist" Postgres error for a still-cryptographically-valid refresh token issued before the
    // purge. Deliberately NOT a pre-check via tenantsService.getTenant()==null: schema-only test
    // tenants (no registry row — the established fail-open convention this codebase's other
    // registry-gated checks share) would then also be wrongly rejected, since a missing registry
    // row is indistinguishable from a purged one by that signal alone. The tenant schema itself is
    // the ground truth either way, so catching its actual failure here is both correct and doesn't
    // disturb that convention: a schema-only test tenant's schema genuinely still exists and this
    // call succeeds for it exactly as before.
    let found: Awaited<ReturnType<AccountsService['getAccountWithRoles']>>;
    try {
      found = await this.tenantContext.run(
        { tenantId: payload.hospitalId, correlationId: 'auth-refresh' },
        () => this.accountsService.getAccountWithRoles(payload.sub),
      );
    } catch (err) {
      this.logger.warn(
        `refresh() account lookup failed for hospitalId "${payload.hospitalId}" — treating as invalid token: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { invalidToken: true };
    }
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
    const statusGate = await this.checkTenantStatusGate(payload.hospitalId);
    if ('tenantInactive' in statusGate) {
      return { invalidToken: true };
    }

    const permissions = await this.packagesService.filterPermissions(
      payload.hospitalId,
      await this.accountsService.getPermissionNamesForRoles(found.roleIds),
      statusGate.packageCode,
    );
    const accessPayload = this.buildAccessPayload(
      found.account.id,
      found.roleNames,
      permissions,
      payload.hospitalId,
      found.account.accountType,
      found.account.patientId,
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
    accountType: 'staff' | 'patient',
    patientId: string | null,
  ) {
    return {
      sub: accountId,
      roles,
      permissions,
      hospitalId,
      type: 'access' as const,
      accountType,
      // Omitted rather than null: keeps the JWT payload consistent with AccessTokenPayload's
      // optional-string shape (auth-context.middleware.ts) for the common staff-account case.
      patientId: patientId ?? undefined,
    };
  }
}
