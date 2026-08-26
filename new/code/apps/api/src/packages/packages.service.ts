import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Package } from './entities/package.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
import { PACKAGE_CATALOG, ALWAYS_ON_PERMISSION_PREFIXES, MODULE_PERMISSION_PREFIXES, permissionAllowed } from './package-catalog.js';

/**
 * Resolves a tenant's SaaS package and filters its permission list accordingly. Enforced at
 * JWT-issue time (AuthService.login/refresh): a tenant's access tokens only carry permissions
 * whose modules are in its package, so PermissionGuard 403s and the console menus (both
 * permission-driven) hide out-of-package features without any per-request machinery.
 *
 * Schema stays uniform across tenants — packages gate access, not data. Upgrades take effect at
 * the next login/refresh (in-flight JWTs keep their old permission list until expiry, the same
 * 15-minute staleness role changes already have); downgrades revoke at the next login/refresh,
 * and the tenant's data is untouched.
 */
@Injectable()
export class PackagesService {
  private readonly logger = new Logger(PackagesService.name);

  /** Prefixes already warned about — an unmapped prefix is a config bug, not a per-login event. */
  private readonly warnedUnmappedPrefixes = new Set<string>();

  constructor(private readonly dataSource: DataSource) {}

  async listPackages(): Promise<Array<Package & { defaultRoleNames: string[] }>> {
    const rows = await this.dataSource.getRepository(Package).find({ order: { createdAt: 'ASC' } });
    // defaultRoleNames lives in the code catalog (package-catalog.ts), not the DB row — merge it
    // so the console can annotate which roles each package enables.
    return rows.map((pkg) => ({
      ...pkg,
      defaultRoleNames: PACKAGE_CATALOG.find((p) => p.code === pkg.code)?.defaultRoleNames ?? [],
    }));
  }

  async getPackage(code: string): Promise<Package | null> {
    return this.dataSource.getRepository(Package).findOne({ where: { code } });
  }

  async getTenantPackageCode(hospitalId: string): Promise<string | null> {
    const row: { packageCode: string } | undefined = await this.dataSource
      .getRepository(Tenant)
      .createQueryBuilder('tenant')
      .select('tenant.packageCode', 'packageCode')
      .where('tenant.hospitalId = :hospitalId', { hospitalId })
      .getRawOne();
    return row?.packageCode ?? null;
  }

  /**
   * Intersects a role-derived permission list with the tenant's package modules. Never filters
   * the platform tenant (Super Admin is cross-tenant ops, not a hospital), and fails open on an
   * unknown package code — codes are validated at provision/change time, so an unknown row means
   * a legacy/edge case where hiding access would be worse than showing it.
   *
   * `knownPackageCode` lets a caller that already fetched the tenant row (e.g. `AuthService`,
   * which also needs the row for its tenant-status gate) pass the package code straight through
   * instead of this method re-querying `tenants` for it — omit it (the default) to have this
   * method look it up itself, same as before.
   */
  async filterPermissions(
    hospitalId: string | undefined,
    permissions: string[],
    knownPackageCode?: string | null,
  ): Promise<string[]> {
    if (!hospitalId || hospitalId === PLATFORM_TENANT_ID) {
      return permissions;
    }
    const packageCode =
      knownPackageCode === undefined ? await this.getTenantPackageCode(hospitalId) : knownPackageCode;
    const pkg = packageCode ? await this.getPackage(packageCode) : null;
    if (!pkg) {
      return permissions;
    }
    return permissions.filter((permission) => {
      const allowed = permissionAllowed(permission, pkg.modules);
      if (!allowed) {
        this.warnIfPrefixUnmapped(permission);
      }
      return allowed;
    });
  }

  /**
   * An unmapped permission prefix fails closed with no signal — a permission whose prefix is in
   * NO module key (and not always-on) is stripped from every tenant's JWT, silently, even for
   * packages that should carry it (code-review-findings-2026-08-25 rbac P3). Warn once per
   * prefix so the gap is observable without spamming the log on every login.
   */
  private warnIfPrefixUnmapped(permission: string): void {
    if (
      ALWAYS_ON_PERMISSION_PREFIXES.some(
        (prefix) => permission === prefix || permission.startsWith(`${prefix}.`),
      )
    ) {
      return;
    }
    const prefix = permission.split('.')[0];
    const isMapped = Object.values(MODULE_PERMISSION_PREFIXES).some((prefixes) =>
      prefixes.includes(prefix),
    );
    if (isMapped || this.warnedUnmappedPrefixes.has(prefix)) {
      return;
    }
    this.warnedUnmappedPrefixes.add(prefix);
    this.logger.warn(
      `Permission prefix "${prefix}" (from "${permission}") has no module mapping and is not always-on — ` +
        'it is being stripped from every tenant JWT. Add it to MODULE_PERMISSION_PREFIXES or ' +
        'ALWAYS_ON_PERMISSION_PREFIXES in packages/package-catalog.ts.',
    );
  }
}
