import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Package } from './entities/package.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
import { permissionAllowed } from './package-catalog.js';

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
  constructor(private readonly dataSource: DataSource) {}

  async listPackages(): Promise<Package[]> {
    return this.dataSource.getRepository(Package).find({ order: { createdAt: 'ASC' } });
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
   */
  async filterPermissions(
    hospitalId: string | undefined,
    permissions: string[],
  ): Promise<string[]> {
    if (!hospitalId || hospitalId === PLATFORM_TENANT_ID) {
      return permissions;
    }
    const packageCode = await this.getTenantPackageCode(hospitalId);
    const pkg = packageCode ? await this.getPackage(packageCode) : null;
    if (!pkg) {
      return permissions;
    }
    return permissions.filter((permission) => permissionAllowed(permission, pkg.modules));
  }
}
