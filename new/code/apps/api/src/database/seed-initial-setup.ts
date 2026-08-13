import { DataSource } from 'typeorm';
import { Role } from '../rbac/entities/role.entity.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
import { Account } from '../accounts/entities/account.entity.js';
import { AccountRole } from '../accounts/entities/account-role.entity.js';
import * as bcrypt from 'bcrypt';

interface MasterAdminConfig {
  username: string;
  email: string;
  password: string;
  displayName: string;
}

function getMasterAdminConfig(): MasterAdminConfig {
  return {
    username: process.env['MASTER_ADMIN_USERNAME'] ?? 'superadmin',
    email: process.env['MASTER_ADMIN_EMAIL'] ?? 'superadmin@hospital.local',
    password: process.env['MASTER_ADMIN_PASSWORD'] ?? 'SuperAdmin@123!',
    displayName: process.env['MASTER_ADMIN_DISPLAY_NAME'] ?? 'System Administrator',
  };
}

export async function seedMasterAdmin(dataSource: DataSource): Promise<void> {
  const config = getMasterAdminConfig();
  
  const accountRepository = dataSource.getRepository(Account);
  const roleRepository = dataSource.getRepository(Role);
  const accountRoleRepository = dataSource.getRepository(AccountRole);

  // Find or create Super Admin role
  let superAdminRole = await roleRepository.findOne({ 
    where: { name: 'Super Admin' } 
  });

  if (!superAdminRole) {
    console.warn('Super Admin role not found. Please run RBAC catalog seeding first.');
    return;
  }

  // Check if master admin already exists
  const existingAdmin = await accountRepository.findOne({
    where: { username: config.username }
  });

  if (existingAdmin) {
    console.log(`Master admin account '${config.username}' already exists. Skipping creation.`);
    return;
  }

  // Create master admin account
  const passwordHash = await bcrypt.hash(config.password, 10);
  
  const masterAdmin = accountRepository.create({
    accountType: 'staff',
    displayName: config.displayName,
    username: config.username,
    email: config.email,
    passwordHash,
    isActive: true,
    needsPasswordUpdate: false,
    failedLoginAttempts: 0,
  });

  await accountRepository.save(masterAdmin);
  console.log(`✓ Created master admin account: ${config.username}`);

  // Assign Super Admin role
  const accountRole = accountRoleRepository.create({
    accountId: masterAdmin.id,
    roleId: superAdminRole.id,
    isActive: true,
    startDate: new Date(),
  });

  await accountRoleRepository.save(accountRole);
  console.log(`✓ Assigned 'Super Admin' role to ${config.username}`);
}

export async function seedInitialRolesAndPermissions(dataSource: DataSource): Promise<void> {
  console.log('Seeding initial roles and permissions...');
  
  const roleRepository = dataSource.getRepository(Role);
  const permissionRepository = dataSource.getRepository(Permission);
  const rolePermissionRepository = dataSource.getRepository(RolePermission);

  // Define essential roles if not already seeded
  const essentialRoles = [
    {
      name: 'Super Admin',
      description: 'Cross-hospital vendor/ops access to every service and tenant.',
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
    const existing = await roleRepository.findOne({ where: { name: roleSeed.name } });
    if (!existing) {
      await roleRepository.save(roleRepository.create(roleSeed));
      console.log(`✓ Created role: ${roleSeed.name}`);
    }
  }

  // Define essential permissions
  const essentialPermissions = [
    { name: 'identity.accounts.manage', description: 'Manage all accounts and role assignments' },
    { name: 'system-admin.tenants.manage', description: 'Manage hospital tenants' },
    { name: 'master-data.manage', description: 'Manage departments and wards' },
    { name: 'users.all.read', description: 'Read access to all users' },
    { name: 'system.config.manage', description: 'Manage system configuration' },
  ];

  for (const permSeed of essentialPermissions) {
    const existing = await permissionRepository.findOne({ where: { name: permSeed.name } });
    if (!existing) {
      await permissionRepository.save(permissionRepository.create(permSeed));
      console.log(`✓ Created permission: ${permSeed.name}`);
    }
  }

  // Assign all essential permissions to Super Admin role
  const superAdminRole = await roleRepository.findOne({ where: { name: 'Super Admin' } });
  if (superAdminRole) {
    const allPermissions = await permissionRepository.find();
    for (const permission of allPermissions) {
      const existingMapping = await rolePermissionRepository.findOne({
        where: { roleId: superAdminRole.id, permissionId: permission.id }
      });
      if (!existingMapping) {
        await rolePermissionRepository.save(
          rolePermissionRepository.create({
            roleId: superAdminRole.id,
            permissionId: permission.id,
          })
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
  await seedMasterAdmin(dataSource);
  
  console.log('\n✓ Initial setup completed successfully!');
  console.log('\n--- Login Credentials ---');
  console.log(`Username: ${process.env['MASTER_ADMIN_USERNAME'] ?? 'superadmin'}`);
  console.log(`Password: ${process.env['MASTER_ADMIN_PASSWORD'] ?? 'SuperAdmin@123!'}`);
  console.log('-------------------------\n');
  console.log('⚠️  IMPORTANT: Change the default password immediately after first login!\n');
}
