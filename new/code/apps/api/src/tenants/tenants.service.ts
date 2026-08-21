import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { Tenant } from './entities/tenant.entity.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { Role } from '../rbac/entities/role.entity.js';
import { DepartmentCatalog } from '../master-data/entities/department-catalog.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { PACKAGE_CATALOG } from '../packages/package-catalog.js';
import { PLATFORM_TENANT_ID } from './platform-tenant.js';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

/** A catalog role plus whether this tenant currently has it enabled. */
export interface TenantRoleOption {
  id: string;
  name: string;
  description: string;
  priority: number;
  isCrossTenant: boolean;
  enabled: boolean;
}

/** A role that could not be disabled, and the accounts still holding it. */
export interface BlockedRole {
  roleId: string;
  roleName: string;
  accounts: string[];
}

export interface ProvisionTenantInput {
  hospitalId: string;
  hospitalName: string;
  /** The SaaS package to provision under; defaults to 'basic' (the MVP launch tier). */
  packageCode?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
    private readonly packagesService: PackagesService,
  ) {}

  /**
   * Actor fields (`createdBy`) are never trusted from the caller: the authenticated principal
   * (TenantContextService.accountId, set by TenantContextMiddleware from the verified JWT)
   * wins; the passed value is only a fallback for non-HTTP callers (service specs) that run
   * without a tenant context. `createdBy` records who provisioned the tenant, so spoofing it
   * would be an audit-trail integrity breach.
   */
  private resolveActor(fallback?: string): string {
    return this.tenantContext.getAccountId() ?? (fallback as string);
  }

  async provisionTenant(input: ProvisionTenantInput): Promise<Tenant> {
    if (!SAFE_HOSPITAL_ID.test(input.hospitalId)) {
      throw new BadRequestException(`Invalid hospitalId format: ${input.hospitalId}`);
    }

    if (input.hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot be provisioned`,
      );
    }

    const repository = this.dataSource.getRepository(Tenant);
    const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
    if (existing) {
      throw new ConflictException(`Tenant ${input.hospitalId} already exists`);
    }

    // Validate the package before doing any work — an unknown code must fail fast, not silently
    // fall back to 'basic' and hide the wrong feature set from the customer.
    const packageCode = input.packageCode ?? 'basic';
    const pkg = await this.packagesService.getPackage(packageCode);
    if (!pkg) {
      throw new BadRequestException(`Unknown packageCode: ${packageCode}`);
    }

    // Schema/role/migrations before the registry row: if provisioning fails partway through, no
    // registry row exists to make the tenant look ready when it isn't.
    await this.tenantProvisioning.provisionTenantSchema(input.hospitalId);

    let roles: Role[] = [];
    if (input.roleIds && input.roleIds.length > 0) {
      roles = await this.dataSource.getRepository(Role)
        .createQueryBuilder('role')
        .where('role.id IN (:...ids)', { ids: input.roleIds })
        .getMany();
      this.assertNoCrossTenantRoles(roles);
    } else {
      // Package-driven defaults: when the platform console doesn't hand-pick roles, enable the
      // catalog roles the package names (never Super Admin — cross-tenant ops role). Individual
      // roles stay switchable later via the per-tenant role toggles.
      roles = await this.resolvePackageDefaultRoles(packageCode);
    }

    const tenant = await repository.save(
      repository.create({
        hospitalId: input.hospitalId,
        hospitalName: input.hospitalName,
        status: 'active',
        packageCode,
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: this.resolveActor(input.createdBy),
      }),
    );

    // Persist the enabled roles explicitly — the ManyToMany cascade on save() silently no-ops
    // for these detached Role rows (tenant_roles stayed empty), so this raw insert is the same
    // path setTenantRoles() already uses and cannot be skipped.
    if (roles.length > 0) {
      await this.dataSource.query(
        `INSERT INTO tenant_roles ("tenantId", "roleId")
         SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [input.hospitalId, roles.map((role) => role.id)],
      );
    }
    tenant.roles = roles;

    // Seed local departments
    if (input.departmentCatalogIds && input.departmentCatalogIds.length > 0) {
      const catalogs = await this.dataSource.getRepository(DepartmentCatalog)
        .createQueryBuilder('catalog')
        .where('catalog.id IN (:...ids)', { ids: input.departmentCatalogIds })
        .getMany();
      
      if (catalogs.length > 0) {
        // provisionTenant runs outside any per-request tenant context (it's what CREATES the
        // tenant), so runInTenantSchema has no ambient schema to resolve — establish one for
        // just this seeding call via TenantContextService.run(), the same pattern the test
        // helper's inTenant() uses.
        await this.tenantContext.run(
          { tenantId: input.hospitalId, correlationId: 'tenant-provisioning' },
          () =>
            this.tenantConnection.runInTenantSchema(async (manager) => {
              const deptRepo = manager.getRepository(Department);
              const depts = catalogs.map((c) =>
                deptRepo.create({
                  departmentCode: c.departmentCode,
                  departmentName: c.departmentName,
                  description: c.description,
                  isAppointmentApplicable: c.isAppointmentApplicable,
                  isActive: c.isActive,
                }),
              );
              await deptRepo.save(depts);
            }),
        );
      }
    }

    return tenant;
  }

  /**
   * The full role catalog with a per-tenant `enabled` flag, so the console can render one toggle
   * per role without a second round trip to work out which are on.
   */
  async listTenantRoles(hospitalId: string): Promise<TenantRoleOption[]> {
    const tenant = await this.getTenant(hospitalId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }

    const catalog = await this.dataSource
      .getRepository(Role)
      .find({ order: { priority: 'DESC', name: 'ASC' } });

    const enabled: { roleId: string }[] = await this.dataSource.query(
      `SELECT "roleId" FROM tenant_roles WHERE "tenantId" = $1`,
      [hospitalId],
    );
    const enabledIds = new Set(enabled.map((row) => row.roleId));

    return catalog.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      priority: role.priority,
      isCrossTenant: role.isCrossTenant,
      enabled: enabledIds.has(role.id),
    }));
  }

  /**
   * Replaces the tenant's enabled role set.
   *
   * A role that accounts still actively hold is never silently withdrawn: disabling it is refused
   * with the blocking accounts named, so an administrator reassigns them deliberately rather than
   * discovering mid-shift that staff lost access. The holder check runs inside the tenant's own
   * schema, since `account_roles` is per-tenant.
   */
  async setTenantRoles(hospitalId: string, roleIds: string[]): Promise<TenantRoleOption[]> {
    const tenant = await this.getTenant(hospitalId);
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }

    const requested = new Set(roleIds);
    const catalog = await this.dataSource.getRepository(Role).find();
    const known = new Set(catalog.map((role) => role.id));
    const unknown = roleIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown roleId(s): ${unknown.join(', ')}`);
    }

    // Cross-tenant roles (Super Admin) are platform-only — a customer tenant must never hold
    // them, or it could carry system-admin permissions (tenant management) in staff JWTs.
    this.assertNoCrossTenantRoles(catalog.filter((role) => roleIds.includes(role.id)));

    const currentlyEnabled: { roleId: string }[] = await this.dataSource.query(
      `SELECT "roleId" FROM tenant_roles WHERE "tenantId" = $1`,
      [hospitalId],
    );
    const beingDisabled = currentlyEnabled
      .map((row) => row.roleId)
      .filter((id) => !requested.has(id));

    if (beingDisabled.length > 0) {
      const blocked = await this.findRolesInUse(hospitalId, beingDisabled, catalog);
      if (blocked.length > 0) {
        throw new ConflictException({
          message: 'Cannot disable a role that accounts still hold. Reassign them first.',
          blocked,
        });
      }
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DELETE FROM tenant_roles WHERE "tenantId" = $1`, [hospitalId]);
      if (roleIds.length > 0) {
        await manager.query(
          `INSERT INTO tenant_roles ("tenantId", "roleId")
           SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
          [hospitalId, roleIds],
        );
      }
    });

    return this.listTenantRoles(hospitalId);
  }

  /** Which of `roleIds` are still actively assigned inside the tenant's schema, and to whom. */
  private async findRolesInUse(
    hospitalId: string,
    roleIds: string[],
    catalog: Role[],
  ): Promise<BlockedRole[]> {
    const rows: { roleId: string; username: string }[] = await this.tenantContext.run(
      { tenantId: hospitalId, correlationId: 'tenant-roles-check' },
      () =>
        this.tenantConnection.runInTenantSchema((manager) =>
          manager.query(
            `SELECT ar."roleId", a.username
             FROM account_roles ar
             JOIN accounts a ON a.id = ar."accountId"
             WHERE ar."isActive" = true AND ar."roleId" = ANY($1::uuid[])
             ORDER BY a.username`,
            [roleIds],
          ),
        ),
    );

    const byRole = new Map<string, string[]>();
    for (const row of rows) {
      const usernames = byRole.get(row.roleId) ?? [];
      usernames.push(row.username);
      byRole.set(row.roleId, usernames);
    }

    return [...byRole.entries()].map(([roleId, accounts]) => ({
      roleId,
      roleName: catalog.find((role) => role.id === roleId)?.name ?? roleId,
      accounts,
    }));
  }

  /**
   * Switches a tenant's SaaS package (upgrade or downgrade). Resolution-time gating means no
   * permission rows need touching: the new package takes effect at the next login/refresh, so
   * in-flight JWTs keep their old permission list until expiry (the same staleness window role
   * changes already have). The tenant's data is never touched. The new package's default roles
   * are added to the tenant's enabled set (never removed — switching a role off stays an
   * explicit platform-console action, so downgrades don't silently strip access someone still
   * holds).
   */
  async setTenantPackage(hospitalId: string, packageCode: string): Promise<Tenant> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot change package`,
      );
    }
    const pkg = await this.packagesService.getPackage(packageCode);
    if (!pkg) {
      throw new BadRequestException(`Unknown packageCode: ${packageCode}`);
    }
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.packageCode !== packageCode) {
      tenant.packageCode = packageCode;
      await repository.save(tenant);
      await this.addPackageDefaultRoles(hospitalId, packageCode);
    }
    return tenant;
  }

  async listTenants(): Promise<Tenant[]> {
    // The platform tenant is not a hospital — it must never surface in a customer listing.
    return this.dataSource.getRepository(Tenant).find({
      where: { hospitalId: Not(PLATFORM_TENANT_ID) },
      order: { createdAt: 'ASC' },
    });
  }

  async getTenant(hospitalId: string): Promise<Tenant | null> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      return null;
    }
    return this.dataSource.getRepository(Tenant).findOne({ where: { hospitalId } });
  }

  async suspendTenant(hospitalId: string): Promise<Tenant> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot be suspended`,
      );
    }
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'suspended') {
      return tenant;
    }
    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    return repository.save(tenant);
  }

  async reactivateTenant(hospitalId: string): Promise<Tenant> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot be reactivated`,
      );
    }
    const repository = this.dataSource.getRepository(Tenant);
    const tenant = await repository.findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (tenant.status === 'active') {
      return tenant;
    }
    tenant.status = 'active';
    tenant.activatedAt = new Date();
    return repository.save(tenant);
  }

  /** The catalog Role rows named by a package's default role set (cross-tenant roles excluded). */
  private async resolvePackageDefaultRoles(packageCode: string): Promise<Role[]> {
    const pkg = PACKAGE_CATALOG.find((p) => p.code === packageCode);
    if (!pkg || pkg.defaultRoleNames.length === 0) {
      return [];
    }
    return this.dataSource.getRepository(Role).find({
      where: { name: In(pkg.defaultRoleNames) },
    });
  }

  /** Rejects any cross-tenant role (Super Admin) from a customer tenant's role set. */
  private assertNoCrossTenantRoles(roles: Role[]): void {
    const crossTenant = roles.filter((role) => role.isCrossTenant);
    if (crossTenant.length > 0) {
      throw new BadRequestException(
        `Role(s) ${crossTenant.map((r) => r.name).join(', ')} are platform-only and cannot be enabled for a hospital tenant`,
      );
    }
  }

  /** Enables a package's default roles for an existing tenant (add-only, idempotent). */
  private async addPackageDefaultRoles(hospitalId: string, packageCode: string): Promise<void> {
    const roles = await this.resolvePackageDefaultRoles(packageCode);
    const assignable = roles.filter((role) => !role.isCrossTenant);
    if (assignable.length === 0) {
      return;
    }
    await this.dataSource.query(
      `INSERT INTO tenant_roles ("tenantId", "roleId")
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [hospitalId, assignable.map((role) => role.id)],
    );
  }
}
