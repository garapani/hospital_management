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
    expect(role.bypassesPermissionChecks).toBe(false);
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
});
