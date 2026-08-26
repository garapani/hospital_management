import { ConflictException } from '@nestjs/common';
import { Like } from 'typeorm';
import { RoleManagementService } from './role-management.service.js';
import { Role } from './entities/role.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// Role names live in the shared platform `roles` table (no per-test schema isolation), so every
// name used here is prefixed to avoid colliding with real seeded roles or other test runs, and
// rows are deleted by that prefix on both ends — before, in case a prior run crashed mid-test, and
// after, for a clean exit. Mirrors tenant-test-context.ts's provisionTenant() "drop before create"
// idempotency for the same reason.
const PREFIX = 'role_mgmt_svc_test__';

describe('RoleManagementService (integration)', () => {
  let ctx: TenantTestContext;
  let roleManagementService: RoleManagementService;

  const cleanup = () => ctx.dataSource.getRepository(Role).delete({ name: Like(`${PREFIX}%`) });

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'role_mgmt_svc' });
    roleManagementService = new RoleManagementService(ctx.dataSource);
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTenantTestContext(ctx);
  });

  it('creates a role as active', async () => {
    const role = await roleManagementService.createRole({
      name: `${PREFIX}Ward Coordinator`,
      description: 'Coordinates ward operations',
      priority: 10,
    });
    expect(role.name).toBe(`${PREFIX}Ward Coordinator`);
    expect(role.isActive).toBe(true);
    expect(role.isCrossTenant).toBe(false);
  });

  it('rejects a duplicate role name with 409', async () => {
    await roleManagementService.createRole({
      name: `${PREFIX}Duplicate Role`,
      description: 'First',
      priority: 5,
    });
    await expect(
      roleManagementService.createRole({
        name: `${PREFIX}Duplicate Role`,
        description: 'Second',
        priority: 5,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('lists roles ordered by priority desc then name asc', async () => {
    await roleManagementService.createRole({
      name: `${PREFIX}Low Priority Role`,
      description: 'Low',
      priority: 1,
    });
    await roleManagementService.createRole({
      name: `${PREFIX}High Priority Role`,
      description: 'High',
      priority: 99,
    });

    const roles = await roleManagementService.listRoles();
    const highIndex = roles.findIndex((r: Role) => r.name === `${PREFIX}High Priority Role`);
    const lowIndex = roles.findIndex((r: Role) => r.name === `${PREFIX}Low Priority Role`);
    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(lowIndex).toBeGreaterThan(highIndex);
  });

  it('updates description and priority, leaving the name immutable', async () => {
    const role = await roleManagementService.createRole({
      name: `${PREFIX}Editable Role`,
      description: 'Original description',
      priority: 10,
    });

    const updated = await roleManagementService.updateRole(role.id, {
      description: 'Edited description',
      priority: 77,
    });
    expect(updated.name).toBe(`${PREFIX}Editable Role`);
    expect(updated.description).toBe('Edited description');
    expect(updated.priority).toBe(77);
  });

  it('deactivates and reactivates a role', async () => {
    const role = await roleManagementService.createRole({
      name: `${PREFIX}Toggled Role`,
      description: 'Toggle me',
      priority: 20,
    });

    const deactivated = await roleManagementService.deactivateRole(role.id);
    expect(deactivated.isActive).toBe(false);

    const reactivated = await roleManagementService.reactivateRole(role.id);
    expect(reactivated.isActive).toBe(true);
  });

  it('never allows deactivating a cross-tenant (platform) role', async () => {
    const superAdmin = await ctx.dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: 'Super Admin' } });

    await expect(roleManagementService.deactivateRole(superAdmin.id)).rejects.toThrow(
      'platform role and cannot be deactivated',
    );
  });

  it('returns 404 for update/deactivate/reactivate of an unknown role', async () => {
    const unknown = '00000000-0000-0000-0000-000000000000';
    await expect(
      roleManagementService.updateRole(unknown, { description: 'x' }),
    ).rejects.toThrow('not found');
    await expect(roleManagementService.deactivateRole(unknown)).rejects.toThrow('not found');
    await expect(roleManagementService.reactivateRole(unknown)).rejects.toThrow('not found');
  });
});
