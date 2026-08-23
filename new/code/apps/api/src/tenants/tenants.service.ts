import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, Not } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { ObjectStorageService } from '@hospital/object-storage';
import { Tenant } from './entities/tenant.entity.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { Role } from '../rbac/entities/role.entity.js';
import { DepartmentCatalog } from '../master-data/entities/department-catalog.entity.js';
import { Department } from '../master-data/entities/department.entity.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { PACKAGE_CATALOG } from '../packages/package-catalog.js';
import { PLATFORM_TENANT_ID } from './platform-tenant.js';
import { TenantBranding } from '../platform-branding/entities/tenant-branding.entity.js';
import { randomBytes } from 'node:crypto';

const SAFE_HOSPITAL_ID = /^[a-z0-9_]+$/;

/** 12-character bootstrap password (URL-safe, no ambiguous chars). */
function generateBootstrapPassword(): string {
  return randomBytes(9).toString('base64url');
}

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
  /** Optional bootstrap Hospital Admin account. When omitted, the backend generates a username
   *  and password and returns them as `adminCredentials` in the response. */
  adminUsername?: string;
  adminEmail?: string;
  adminPassword?: string;
  /** Deprecated — ignored when a tenant context with an accountId is active. */
  createdBy?: string;
  roleIds?: string[];
  departmentCatalogIds?: string[];
}

export interface AdminCredentials {
  username: string;
  password: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly tenantConnection: TenantConnectionService,
    private readonly tenantContext: TenantContextService,
    private readonly packagesService: PackagesService,
    private readonly accountsService: AccountsService,
    private readonly objectStorage: ObjectStorageService,
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

  async provisionTenant(
    input: ProvisionTenantInput,
  ): Promise<Tenant & { adminCredentials: AdminCredentials }> {
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

    // Registry-row insert through bootstrap-admin creation isn't atomic as one DB transaction —
    // tenant_roles' FK to tenants("hospitalId") requires the registry row to exist first, and
    // department-seed/bootstrap-admin both run in their OWN tenant-schema transaction via
    // runInTenantSchema (SET LOCAL ROLE/search_path), which can't be nested inside this
    // platform-schema transaction. So instead: on any failure in this block, best-effort delete
    // the registry row we just inserted (tenant_roles cascades away with it) before rethrowing.
    // That keeps `hospitalId` immediately retryable — the alternative (leaving the row behind)
    // is what previously forced archive+purge just to retry a transient failure. The schema/role
    // created above are deliberately left behind: provisionTenantSchema's CREATE SCHEMA IF NOT
    // EXISTS + idempotent migration runner make re-running it on retry a safe no-op/resume.
    let tenant: Tenant;
    let adminCredentials: AdminCredentials;
    try {
      tenant = await repository.save(
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

      // Bootstrap the Hospital Admin account — the platform admin's only job for the new tenant;
      // the hospital admin then creates all further staff accounts. Without this the tenant has
      // no login path at all (account creation requires a session). A generated password is
      // returned once in the response for handover.
      adminCredentials = await this.createBootstrapAdmin(input.hospitalId, {
        username: input.adminUsername,
        email: input.adminEmail,
        password: input.adminPassword,
      });
    } catch (err) {
      await this.dataSource
        .getRepository(Tenant)
        .delete({ hospitalId: input.hospitalId })
        .catch(() => undefined);
      throw err;
    }

    return { ...tenant, adminCredentials };
  }

  /** Creates (or returns credentials for) the tenant's initial Hospital Admin account. */
  private async createBootstrapAdmin(
    hospitalId: string,
    provided: { username?: string; email?: string; password?: string },
  ): Promise<AdminCredentials> {
    const username = provided.username ?? `admin.${hospitalId}`;
    const password = provided.password ?? generateBootstrapPassword();
    const email = provided.email ?? `${username}@${hospitalId}.local`;

    await this.tenantContext.run(
      { tenantId: hospitalId, correlationId: 'tenant-provisioning' },
      () =>
        this.accountsService.createStaffAccount({
          username,
          email,
          displayName: 'Hospital Administrator',
          password,
          roleName: 'Hospital Admin',
          needsPasswordUpdate: provided.password ? false : true,
        }),
    );

    return { username, password };
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

  /**
   * Asserts that a hospitalId points to a valid customer tenant. Rejects the platform tenant,
   * unknown IDs, and (optionally) statuses not in the allowed list.
   *
   * @param actionLabel The verb for the rejection message (e.g. 'be modified')
   */
  async assertValidHospitalTenant(hospitalId: string, allowedStatuses?: string[], actionLabel = 'be modified'): Promise<Tenant> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot ${actionLabel}`,
      );
    }
    const tenant = await this.dataSource.getRepository(Tenant).findOne({ where: { hospitalId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${hospitalId} not found`);
    }
    if (allowedStatuses && !allowedStatuses.includes(tenant.status)) {
      throw new BadRequestException(
        `Tenant ${hospitalId} has status '${tenant.status}'; must have status ${allowedStatuses.join(', ')}`,
      );
    }
    return tenant;
  }

  async suspendTenant(hospitalId: string): Promise<Tenant> {
    const tenant = await this.assertValidHospitalTenant(hospitalId, undefined, 'be suspended');
    // Archived is a distinct state machine (see archiveTenant/restoreTenant) — suspending an
    // archived tenant in place would flip status to 'suspended' while leaving archivedAt stale,
    // since only restoreTenant knows to clear it. Restore first, then suspend if still needed.
    if (tenant.status === 'archived') {
      throw new BadRequestException(
        `Tenant ${hospitalId} is archived; restore it before suspending`,
      );
    }
    if (tenant.status === 'suspended') {
      return tenant;
    }
    tenant.status = 'suspended';
    tenant.suspendedAt = new Date();
    return this.dataSource.getRepository(Tenant).save(tenant);
  }

  async reactivateTenant(hospitalId: string): Promise<Tenant> {
    const tenant = await this.assertValidHospitalTenant(hospitalId, undefined, 'be reactivated');
    // Archived tenants go through restoreTenant instead, which clears archivedAt correctly —
    // reactivateTenant only sets activatedAt, so allowing it here would leave archivedAt stale
    // on an otherwise-active tenant.
    if (tenant.status === 'archived') {
      throw new BadRequestException(
        `Tenant ${hospitalId} is archived; use restore instead of reactivate`,
      );
    }
    if (tenant.status === 'active') {
      return tenant;
    }
    tenant.status = 'active';
    tenant.activatedAt = new Date();
    return this.dataSource.getRepository(Tenant).save(tenant);
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


  /**
   * Soft-delete: marks the tenant archived. The schema and all data are kept, login is blocked
   * (same tenant-status gate as suspend), and restore is always possible. This is the deletion
   * path for churned hospitals; hard purge is a separate, explicit, destructive step.
   */
  async archiveTenant(hospitalId: string): Promise<Tenant> {
    const tenant = await this.assertValidHospitalTenant(hospitalId, undefined, 'be archived');
    if (tenant.status === 'archived') {
      return tenant;
    }
    tenant.status = 'archived';
    tenant.archivedAt = new Date();
    return this.dataSource.getRepository(Tenant).save(tenant);
  }

  /** Reverses an archive: back to active, cleared archive timestamp. */
  async restoreTenant(hospitalId: string): Promise<Tenant> {
    const tenant = await this.assertValidHospitalTenant(hospitalId, undefined, 'be restored');
    if (tenant.status === 'active') {
      return tenant;
    }
    tenant.status = 'active';
    tenant.archivedAt = null;
    tenant.suspendedAt = null;
    return this.dataSource.getRepository(Tenant).save(tenant);
  }

  /**
   * Hard purge — irreversible. Drops the tenant schema + role and the registry row (tenant_roles
   * cascades). Guarded: only an ARCHIVED tenant can be purged, and the caller must confirm the
   * hospitalId explicitly. The platform audit trail (tenant___platform.audit_records) and
   * subscription billing history (subscriptions/subscription_invoices — see migration 0055)
   * survive the drop, so the purge itself stays recorded and revenue history isn't lost.
   *
   * Schema/role drop and registry-row removal all run in one transaction, with the DDL drops
   * ordered *before* the registry-row removal: if DROP SCHEMA/ROLE fails partway through, the
   * transaction rolls back and the registry row is left in place, keeping hospitalId reserved.
   * The prior implementation removed the registry row first and outside any transaction — a
   * failed/hung schema drop after that point freed hospitalId for reuse while the old schema's
   * data was still sitting on disk, so a subsequent provisionTenant() for a new tenant with the
   * same hospitalId would have its `CREATE SCHEMA IF NOT EXISTS` silently succeed against the
   * still-populated old schema, exposing the previous tenant's PHI to the new tenant's admin.
   */
  async purgeTenant(hospitalId: string, confirmHospitalId: string): Promise<{ purged: string }> {
    if (confirmHospitalId !== hospitalId) {
      throw new BadRequestException('Purge requires confirming the hospitalId exactly');
    }
    const tenant = await this.assertValidHospitalTenant(hospitalId, undefined, 'be purged');
    if (tenant.status !== 'archived') {
      throw new BadRequestException(
        `Tenant ${hospitalId} must be archived before it can be purged`,
      );
    }
    // Defense in depth: SAFE_HOSPITAL_ID is enforced at provisionTenant (the only insert path
    // for this row), but the DROP SCHEMA/ROLE statements below interpolate hospitalId directly —
    // re-checking it immediately before that raw DDL means a future insert path that bypassed
    // the original validation (a seed script, a manual fix) still can't reach this as an
    // injection surface.
    if (!SAFE_HOSPITAL_ID.test(hospitalId)) {
      throw new BadRequestException(`Tenant ${hospitalId} has an invalid hospitalId; refusing to purge`);
    }

    const tenantName = `tenant_${hospitalId}`;
    // The branding row is looked up and soft-removed *inside* this transaction (not fetched
    // beforehand) so there's no stale-read window between reading it and acting on it, and so a
    // rollback (e.g. DROP SCHEMA failing on a lingering lock) correctly leaves it untouched too.
    let logoObjectKeyToRemove: string | null = null;
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`DROP SCHEMA IF EXISTS "${tenantName}" CASCADE`);
      await manager.query(`DROP ROLE IF EXISTS "${tenantName}"`);
      await manager.getRepository(Tenant).update(
        { hospitalId },
        { status: 'purged', purgedAt: new Date() }
      );
      // Soft-remove (not hard-delete): TenantBranding extends SoftDeletableEntity, so this only
      // sets deletedAt — TypeORM's default find()/findOne() already excludes soft-deleted rows,
      // so PlatformBrandingService.getPublicBranding needs zero changes to stop serving a purged
      // tenant's display name/logo. Without this, that unauthenticated endpoint kept serving a
      // purged tenant's branding indefinitely, since purge never touched this platform-schema
      // table (only the tenant's own schema/role are dropped above).
      const brandingRow = await manager
        .getRepository(TenantBranding)
        .findOne({ where: { tenantId: hospitalId } });
      if (brandingRow) {
        logoObjectKeyToRemove = brandingRow.logoObjectKey;
        await manager.getRepository(TenantBranding).softRemove(brandingRow);
      }
    });

    // Best-effort logo removal from object storage, deliberately AFTER the transaction commits
    // (not transactional with Postgres either way, but ordered so a mid-transaction failure —
    // e.g. DROP SCHEMA failing on a lingering lock — can never leave the logo file deleted while
    // the DB rolls back to still-archived-with-branding-intact; that combination would have left
    // a broken image with no clean way to retry).
    if (logoObjectKeyToRemove) {
      await this.objectStorage.removeObject(hospitalId, logoObjectKeyToRemove).catch(() => undefined);
    }
    return { purged: hospitalId };
  }
}
