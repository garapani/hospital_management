import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { TenantProvisioningService } from './tenant-provisioning.service.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';

interface SeededAdminConfig {
  tenantId: string;
  hospitalName: string;
  username: string;
  email: string;
  password: string;
  displayName: string;
  roleName: string;
  /** SaaS package for the seeded tenant. Seed tenants are internal (platform + demo), so they
   *  get the largest package — new *customer* tenants default to 'basic' at POST /tenants. */
  packageCode: string;
}

const SAFE_TENANT_ID = /^[a-z0-9_]+$/;

/** The platform operator. Lives in the reserved system tenant, never inside a customer hospital. */
function getPlatformAdminConfig(): SeededAdminConfig {
  return {
    // Overridable ONLY so integration tests can seed into a test-scoped tenant: specs run against
    // the same database as local dev, so a test must never touch the real __platform schema.
    // Tenant reservation in TenantsService keys off the PLATFORM_TENANT_ID constant, never this
    // variable, so overriding it cannot un-reserve the real id.
    tenantId: process.env['PLATFORM_ADMIN_TENANT_ID'] ?? PLATFORM_TENANT_ID,
    hospitalName: 'Platform Administration',
    username: process.env['PLATFORM_ADMIN_USERNAME'] ?? 'superadmin',
    email: process.env['PLATFORM_ADMIN_EMAIL'] ?? 'superadmin@hospital.local',
    password: process.env['PLATFORM_ADMIN_PASSWORD'] ?? 'SuperAdmin@123!',
    displayName: process.env['PLATFORM_ADMIN_DISPLAY_NAME'] ?? 'System Administrator',
    roleName: 'Super Admin',
    packageCode: 'enterprise',
  };
}

/** The demo hospital's own administrator — a tenant user, deliberately NOT a Super Admin. */
function getDemoHospitalAdminConfig(): SeededAdminConfig {
  return {
    tenantId: process.env['MASTER_ADMIN_TENANT_ID'] ?? 'demo',
    hospitalName: process.env['MASTER_ADMIN_TENANT_NAME'] ?? 'Demo Hospital',
    username: process.env['MASTER_ADMIN_USERNAME'] ?? 'demoadmin',
    email: process.env['MASTER_ADMIN_EMAIL'] ?? 'demoadmin@hospital.local',
    password: process.env['MASTER_ADMIN_PASSWORD'] ?? 'DemoAdmin@123!',
    displayName: process.env['MASTER_ADMIN_DISPLAY_NAME'] ?? 'Demo Hospital Administrator',
    roleName: 'Hospital Admin',
    packageCode: 'enterprise',
  };
}

async function ensureSeededTenant(
  dataSource: DataSource,
  config: SeededAdminConfig,
): Promise<void> {
  if (!SAFE_TENANT_ID.test(config.tenantId)) {
    throw new Error(
      `Seed tenant id must match /^[a-z0-9_]+$/ (got: ${config.tenantId})`,
    );
  }

  const tenantProvisioning = new TenantProvisioningService(dataSource);
  await tenantProvisioning.provisionTenantSchema(config.tenantId);

  const tenantRepository = dataSource.getRepository(Tenant);
  const existingTenant = await tenantRepository.findOne({
    where: { hospitalId: config.tenantId },
  });
  if (existingTenant) {
    console.log(
      `Tenant '${config.tenantId}' already exists. Skipping tenant creation.`,
    );
    await enableAllCatalogRoles(dataSource, config.tenantId);
    return;
  }

  await tenantRepository.save(
    tenantRepository.create({
      hospitalId: config.tenantId,
      hospitalName: config.hospitalName,
      status: 'active',
      packageCode: config.packageCode,
      activatedAt: new Date(),
      suspendedAt: null,
      createdBy: 'seed-initial-setup',
    }),
  );
  await enableAllCatalogRoles(dataSource, config.tenantId);
  console.log(`✓ Provisioned tenant: ${config.tenantId}`);
}

/**
 * A tenant with no rows in `tenant_roles` has an empty role list everywhere, because
 * `AccountsService.listRoles()` inner-joins that table whenever a tenant is in context — which
 * means no role can be picked and no staff account can be created. A seeded tenant therefore
 * starts with the whole catalog enabled; narrowing it is what the platform console's per-tenant
 * role toggles are for. Runs on the already-exists path too, so re-seeding repairs a tenant that
 * predates the tenant_roles migration.
 */
async function enableAllCatalogRoles(
  dataSource: DataSource,
  tenantId: string,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO tenant_roles ("tenantId", "roleId")
     SELECT $1, r.id FROM roles r WHERE r."isCrossTenant" = false ON CONFLICT DO NOTHING`,
    [tenantId],
  );
}

async function seedAdminAccount(
  dataSource: DataSource,
  config: SeededAdminConfig,
): Promise<void> {
  const role = await dataSource
    .getRepository(Role)
    .findOne({ where: { name: config.roleName } });

  if (!role) {
    console.warn(
      `${config.roleName} role not found. Please run RBAC catalog seeding first.`,
    );
    return;
  }

  await ensureSeededTenant(dataSource, config);

  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(
    tenantConnection,
    dataSource,
    tenantContext,
  );

  const existing = await tenantContext.run(
    { tenantId: config.tenantId, correlationId: 'seed-initial-setup' },
    () => accountsService.findByUsernameWithRoles(config.username),
  );

  if (existing) {
    console.log(
      `Account '${config.username}' already exists in tenant '${config.tenantId}'. Skipping creation.`,
    );
    return;
  }

  await tenantContext.run(
    { tenantId: config.tenantId, correlationId: 'seed-initial-setup' },
    () =>
      accountsService.createStaffAccount({
        username: config.username,
        email: config.email,
        displayName: config.displayName,
        password: config.password,
        roleName: role.name,
        needsPasswordUpdate: false,
        // The platform admin is the one legitimate holder of a cross-tenant role; every other
        // seeded account (Hospital Admin etc.) goes through the normal guards.
        allowPlatformRole: role.isCrossTenant,
      }),
  );
  console.log(
    `✓ Created ${config.roleName}: ${config.username} (tenant: ${config.tenantId})`,
  );
}

export async function seedPlatformAdmin(dataSource: DataSource): Promise<void> {
  await seedAdminAccount(dataSource, getPlatformAdminConfig());
}

export async function seedDemoHospitalAdmin(dataSource: DataSource): Promise<void> {
  await seedAdminAccount(dataSource, getDemoHospitalAdminConfig());
}

export async function seedInitialRolesAndPermissions(
  dataSource: DataSource,
): Promise<void> {
  console.log('Seeding initial roles and permissions...');

  const roleRepository = dataSource.getRepository(Role);
  const permissionRepository = dataSource.getRepository(Permission);
  const rolePermissionRepository = dataSource.getRepository(RolePermission);

  // Define essential roles if not already seeded
  const essentialRoles = [
    {
      name: 'Super Admin',
      description:
        'Cross-hospital vendor/ops access to every service and tenant.',
      priority: 100,
      bypassesPermissionChecks: true,
      isCrossTenant: true,
    },
    {
      name: 'Hospital Admin',
      description: 'Full access within a single hospital tenant.',
      priority: 90,
      bypassesPermissionChecks: true,
      isCrossTenant: false,
    },
  ];

  for (const roleSeed of essentialRoles) {
    const existing = await roleRepository.findOne({
      where: { name: roleSeed.name },
    });
    if (!existing) {
      await roleRepository.save(roleRepository.create(roleSeed));
      console.log(`✓ Created role: ${roleSeed.name}`);
    }
  }

  // Define essential permissions
  const essentialPermissions = [
    {
      name: 'identity.accounts.manage',
      description: 'Manage all accounts and role assignments',
    },
    {
      name: 'system-admin.tenants.manage',
      description: 'Manage hospital tenants',
    },
    { name: 'master-data.manage', description: 'Manage departments and wards' },
    { name: 'users.all.read', description: 'Read access to all users' },
    {
      name: 'system.config.manage',
      description: 'Manage system configuration',
    },
  ];

  for (const permSeed of essentialPermissions) {
    const existing = await permissionRepository.findOne({
      where: { name: permSeed.name },
    });
    if (!existing) {
      await permissionRepository.save(permissionRepository.create(permSeed));
      console.log(`✓ Created permission: ${permSeed.name}`);
    }
  }

  // Assign all essential permissions to Super Admin role
  const superAdminRole = await roleRepository.findOne({
    where: { name: 'Super Admin' },
  });
  if (superAdminRole) {
    const allPermissions = await permissionRepository.find();
    for (const permission of allPermissions) {
      const existingMapping = await rolePermissionRepository.findOne({
        where: { roleId: superAdminRole.id, permissionId: permission.id },
      });
      if (!existingMapping) {
        await rolePermissionRepository.save(
          rolePermissionRepository.create({
            roleId: superAdminRole.id,
            permissionId: permission.id,
          }),
        );
      }
    }
    console.log(`✓ Assigned all permissions to Super Admin role`);
  }
}

export async function runInitialSetup(dataSource: DataSource): Promise<void> {
  console.log('Starting initial system setup...\n');

  await seedInitialRolesAndPermissions(dataSource);
  console.log('');
  await seedPlatformAdmin(dataSource);
  await seedDemoHospitalAdmin(dataSource);

  const platform = getPlatformAdminConfig();
  const demo = getDemoHospitalAdminConfig();

  console.log('\n✓ Initial setup completed successfully!');
  console.log('\n--- Platform Administrator (http://admin.localhost:4200) ---');
  console.log(`Tenant: ${platform.tenantId}`);
  console.log(`Username: ${platform.username}`);
  console.log(`Password: ${platform.password}`);
  console.log('\n--- Demo Hospital Administrator (http://localhost:4200) ---');
  console.log(`Tenant: ${demo.tenantId}`);
  console.log(`Username: ${demo.username}`);
  console.log(`Password: ${demo.password}`);
  console.log('-------------------------\n');
  console.log(
    '⚠️  IMPORTANT: Change the default passwords immediately after first login!\n',
  );
}
