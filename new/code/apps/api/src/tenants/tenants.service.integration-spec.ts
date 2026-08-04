import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('TenantsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantsService: TenantsService;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_svc' });
    tenantsService = new TenantsService(ctx.dataSource, new TenantProvisioningService(ctx.dataSource));
  });

  afterAll(async () => {
    const hospitalIds: { hospitalId: string }[] = await ctx.dataSource.query(
      `SELECT "hospitalId" FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`,
    );
    for (const { hospitalId } of hospitalIds) {
      const name = `tenant_${hospitalId}`;
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "${name}"`);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`);
    await teardownTenantTestContext(ctx);
  });

  it('provisions a tenant as active with an activatedAt timestamp', async () => {
    const tenant = await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_provision',
      hospitalName: 'Test Hospital Provision',
      createdBy: 'ops.alice',
    });

    expect(tenant.hospitalId).toBe('test_tenant_svc_provision');
    expect(tenant.status).toBe('active');
    expect(tenant.activatedAt).not.toBeNull();
    expect(tenant.createdBy).toBe('ops.alice');
  });

  it('rejects provisioning a hospitalId that already exists with a 409', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_dup',
      hospitalName: 'Dup Hospital',
    });

    await expect(
      tenantsService.provisionTenant({ hospitalId: 'test_tenant_svc_dup', hospitalName: 'Dup Hospital Again' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an unsafe hospitalId format', async () => {
    await expect(
      tenantsService.provisionTenant({ hospitalId: 'Not Safe!', hospitalName: 'Bad Id Hospital' }),
    ).rejects.toThrow();
  });

  it('lists provisioned tenants', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_list',
      hospitalName: 'List Hospital',
    });

    const tenants = await tenantsService.listTenants();
    expect(tenants.some((t) => t.hospitalId === 'test_tenant_svc_list')).toBe(true);
  });

  it('gets a single tenant by hospitalId, or null if unknown', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_get',
      hospitalName: 'Get Hospital',
    });

    const found = await tenantsService.getTenant('test_tenant_svc_get');
    expect(found?.hospitalName).toBe('Get Hospital');

    const missing = await tenantsService.getTenant('test_tenant_svc_nonexistent');
    expect(missing).toBeNull();
  });

  it('suspends an active tenant, recording suspendedAt', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_suspend',
      hospitalName: 'Suspend Hospital',
    });

    const suspended = await tenantsService.suspendTenant('test_tenant_svc_suspend');
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedAt).not.toBeNull();
  });

  it('suspending an already-suspended tenant is an idempotent no-op', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_suspend_twice',
      hospitalName: 'Suspend Twice Hospital',
    });
    await tenantsService.suspendTenant('test_tenant_svc_suspend_twice');

    const secondSuspend = await tenantsService.suspendTenant('test_tenant_svc_suspend_twice');
    expect(secondSuspend.status).toBe('suspended');
  });

  it('reactivates a suspended tenant, recording a fresh activatedAt', async () => {
    await tenantsService.provisionTenant({
      hospitalId: 'test_tenant_svc_reactivate',
      hospitalName: 'Reactivate Hospital',
    });
    await tenantsService.suspendTenant('test_tenant_svc_reactivate');

    const reactivated = await tenantsService.reactivateTenant('test_tenant_svc_reactivate');
    expect(reactivated.status).toBe('active');
    expect(reactivated.activatedAt).not.toBeNull();
  });

  it('suspend/reactivate on an unknown hospitalId throws NotFoundException', async () => {
    await expect(tenantsService.suspendTenant('test_tenant_svc_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
    await expect(tenantsService.reactivateTenant('test_tenant_svc_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
