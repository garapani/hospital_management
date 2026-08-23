import { ConflictException, NotFoundException } from '@nestjs/common';
import { ObjectStorageService } from '@hospital/object-storage';
import { TenantsService } from './tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { PackagesService } from '../packages/packages.service.js';
import { TenantBranding } from '../platform-branding/entities/tenant-branding.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('TenantsService (integration)', () => {
  let ctx: TenantTestContext;
  let tenantsService: TenantsService;

  async function cleanMatchingTenants() {
    const hospitalIds: { hospitalId: string }[] = await ctx.dataSource.query(
      `SELECT "hospitalId" FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`,
    );
    for (const { hospitalId } of hospitalIds) {
      const name = `tenant_${hospitalId}`;
      try {
        await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
        await ctx.dataSource.query(`DROP ROLE IF EXISTS "${name}"`);
      } catch {
        // ignore drop errors during test cleanup
      }
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_svc_%'`);
  }

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'tenant_svc' });
    await cleanMatchingTenants();
    tenantsService = new TenantsService(
      ctx.dataSource,
      new TenantProvisioningService(ctx.dataSource),
      ctx.tenantConnection,
      ctx.tenantContext,
      new PackagesService(ctx.dataSource),
      ctx.accountsService,
      new ObjectStorageService(),
    );
  }, 120000);

  afterAll(async () => {
    await cleanMatchingTenants();
    await teardownTenantTestContext(ctx);
  }, 120000);

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

  it('2.23: a provisioning failure partway through leaves no orphaned registry row, and retry succeeds', async () => {
    const hospitalId = 'test_tenant_svc_provision_fail';
    const [nurseRole] = await ctx.dataSource.query(`SELECT id FROM roles WHERE name = 'Nurse'`);

    // Enabling only "Nurse" (never "Hospital Admin") forces createBootstrapAdmin's unconditional
    // "Hospital Admin" role assignment to fail its role-membership check — reliably failing
    // provisioning at its LAST step, after the registry row/tenant_roles have already committed.
    await expect(
      tenantsService.provisionTenant({
        hospitalId,
        hospitalName: 'Provision Fail Hospital',
        roleIds: [nurseRole.id],
      }),
    ).rejects.toThrow(/not enabled/);

    const [registryRow] = await ctx.dataSource.query(
      `SELECT 1 FROM tenants WHERE "hospitalId" = $1`,
      [hospitalId],
    );
    expect(registryRow).toBeUndefined();

    // Retrying with the SAME hospitalId must not 409 — the whole point of the cleanup. Without
    // it, the only recovery from a partial failure was archive+purge.
    const retried = await tenantsService.provisionTenant({
      hospitalId,
      hospitalName: 'Provision Fail Hospital (retry)',
    });
    expect(retried.hospitalId).toBe(hospitalId);
    expect(retried.status).toBe('active');
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

  describe('actor fields derive from the authenticated principal, never the caller-supplied value', () => {
    // Unlike ctx.inTenant(), this run() sets an accountId — exactly what
    // TenantContextMiddleware does for a real HTTP request (from req.authContext.sub). The
    // service must record THIS account, ignoring the spoofed value passed to it.
    const AUTHENTICATED_ACCOUNT = '00000000-0000-0000-0000-0000000000aa';

    function withActor<T>(work: () => Promise<T>): Promise<T> {
      return ctx.tenantContext.run(
        { tenantId: ctx.tenantId, accountId: AUTHENTICATED_ACCOUNT, correlationId: 'actor-test' },
        work,
      );
    }

    it('provisionTenant records the authenticated account as createdBy, not the body value', async () => {
      const spoofed = '00000000-0000-0000-0000-0000000000ff';

      const tenant = await withActor(() =>
        tenantsService.provisionTenant({
          hospitalId: 'test_tenant_svc_actor',
          hospitalName: 'Actor Hospital',
          createdBy: spoofed,
        }),
      );
      expect(tenant.createdBy).toBe(AUTHENTICATED_ACCOUNT);
    });
  });

  describe('assertValidHospitalTenant', () => {
    it('rejects the platform tenant', async () => {
      // Import PLATFORM_TENANT_ID at the top of the file
      await expect(tenantsService.assertValidHospitalTenant('__platform')).rejects.toThrow(/reserved system tenant/);
    });

    it('rejects an unknown tenant with a 404', async () => {
      await expect(tenantsService.assertValidHospitalTenant('test_tenant_svc_unknown')).rejects.toThrow(NotFoundException);
    });

    it('rejects a tenant whose status is not in the allowed list', async () => {
      await tenantsService.provisionTenant({ hospitalId: 'test_tenant_svc_status_fail', hospitalName: 'Fail Hospital' });
      await tenantsService.archiveTenant('test_tenant_svc_status_fail');

      await expect(
        tenantsService.assertValidHospitalTenant('test_tenant_svc_status_fail', ['active', 'suspended'])
      ).rejects.toThrow(/must have status active, suspended/);
    });

    it('allows a tenant with a valid status', async () => {
      const hospitalId = 'test_tenant_svc_status_ok';
      await tenantsService.provisionTenant({ hospitalId, hospitalName: 'Ok Hospital' });
      const suspended = await tenantsService.suspendTenant(hospitalId);

      const resolved = await tenantsService.assertValidHospitalTenant(hospitalId, ['active', 'suspended']);
      expect(resolved.hospitalId).toEqual(suspended.hospitalId);
    });
  });

  describe('purgeTenant', () => {
    it('rejects purging a tenant that is not archived', async () => {
      await tenantsService.provisionTenant({
        hospitalId: 'test_tenant_svc_purge_not_archived',
        hospitalName: 'Not Archived Hospital',
      });

      await expect(
        tenantsService.purgeTenant(
          'test_tenant_svc_purge_not_archived',
          'test_tenant_svc_purge_not_archived',
        ),
      ).rejects.toThrow(/must be archived/);
    });

    it('drops the schema/role and registry row, but preserves subscription billing history (migration 0055)', async () => {
      const hospitalId = 'test_tenant_svc_purge_ok';
      await tenantsService.provisionTenant({ hospitalId, hospitalName: 'Purge Ok Hospital' });
      await tenantsService.archiveTenant(hospitalId);

      // Simulates a subscription/subscription_invoice row this tenant accrued while active —
      // inserted directly rather than through SubscriptionBillingService to keep this test
      // scoped to the purge behavior, not subscription lifecycle rules.
      const [{ id: subscriptionId }] = await ctx.dataSource.query(
        `INSERT INTO subscriptions ("tenantId", "packageCode", "billingCycle", "pricePerCycle",
                                     "currentPeriodStart", "currentPeriodEnd")
         VALUES ($1, 'basic', 'monthly', 1000, now(), now() + interval '30 days')
         RETURNING id`,
        [hospitalId],
      );

      const result = await tenantsService.purgeTenant(hospitalId, hospitalId);
      expect(result).toEqual({ purged: hospitalId });

      const registryRow = await ctx.dataSource.query(
        `SELECT status, "purgedAt" FROM tenants WHERE "hospitalId" = $1`,
        [hospitalId],
      );
      expect(registryRow[0].status).toBe('purged');
      expect(registryRow[0].purgedAt).not.toBeNull();

      const [schemaRow] = await ctx.dataSource.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [`tenant_${hospitalId}`],
      );
      expect(schemaRow).toBeUndefined();

      // Migration 0055 dropped subscriptions.tenantId's ON DELETE CASCADE FK to tenants —
      // billing/revenue history must outlive the purge even though the tenant registry row is gone.
      const [survivingSubscription] = await ctx.dataSource.query(
        `SELECT "tenantId" FROM subscriptions WHERE id = $1`,
        [subscriptionId],
      );
      expect(survivingSubscription.tenantId).toBe(hospitalId);
    });

    it('soft-removes the tenant_branding row so a purged tenant stops appearing in public branding lookups', async () => {
      const hospitalId = 'test_tenant_svc_purge_branding';
      await tenantsService.provisionTenant({ hospitalId, hospitalName: 'Purge Branding Hospital' });
      await tenantsService.archiveTenant(hospitalId);

      await ctx.dataSource.query(
        `INSERT INTO tenant_branding ("tenantId", "displayName", "logoObjectKey")
         VALUES ($1, 'Purge Branding Test', 'branding/logo.png')`,
        [hospitalId],
      );

      await tenantsService.purgeTenant(hospitalId, hospitalId);

      // TenantBranding extends SoftDeletableEntity, so this only sets deletedAt — TypeORM's
      // default find()/findOne() (no withDeleted) already excludes it, which is exactly what
      // PlatformBrandingService.getPublicBranding relies on. Asserted directly against the
      // repository here (not via PlatformBrandingService, which this spec doesn't wire up) to
      // prove the row is genuinely excluded from a normal query, not just marked in some other way.
      const found = await ctx.dataSource.getRepository(TenantBranding).findOne({ where: { tenantId: hospitalId } });
      expect(found).toBeNull();

      const [rawRow] = await ctx.dataSource.query(
        `SELECT "deletedAt" FROM tenant_branding WHERE "tenantId" = $1`,
        [hospitalId],
      );
      expect(rawRow.deletedAt).not.toBeNull();
    });

    it('2.28: blocks reprovisioning a purged hospitalId outright, and billing history stays attributed to it', async () => {
      const hospitalId = 'test_tenant_svc_purge_reuse';
      await tenantsService.provisionTenant({ hospitalId, hospitalName: 'Purge Reuse Hospital' });
      await ctx.dataSource.query(
        `INSERT INTO subscriptions ("tenantId", "packageCode", "billingCycle", "pricePerCycle",
                                     "currentPeriodStart", "currentPeriodEnd")
         VALUES ($1, 'basic', 'monthly', 1000, now(), now() + interval '30 days')`,
        [hospitalId],
      );
      await tenantsService.archiveTenant(hospitalId);
      await tenantsService.purgeTenant(hospitalId, hospitalId);

      // The core promise of 2.28: a purged hospitalId is never reusable (the tombstoned registry
      // row — status 'purged', never deleted — blocks provisionTenant's own-existing-row check
      // outright), so a subsequent tenant can never inherit or get its billing views polluted by
      // the previous, purged tenant's history under the same id.
      await expect(
        tenantsService.provisionTenant({ hospitalId, hospitalName: 'Reused Id Hospital' }),
      ).rejects.toThrow(/already exists/);

      const [survivingSubscription] = await ctx.dataSource.query(
        `SELECT "tenantId" FROM subscriptions WHERE "tenantId" = $1`,
        [hospitalId],
      );
      expect(survivingSubscription.tenantId).toBe(hospitalId);
    });

    it('a failure partway through the drop leaves the registry row intact, blocking hospitalId reuse', async () => {
      const hospitalId = 'test_tenant_svc_purge_fail';
      const roleName = `tenant_${hospitalId}`;
      await tenantsService.provisionTenant({ hospitalId, hospitalName: 'Purge Fail Hospital' });
      await tenantsService.archiveTenant(hospitalId);

      // Forces a real DROP ROLE failure (role owns an object outside its own schema, so Postgres
      // refuses to drop it) so the transaction rolls back partway through — proving the fix's
      // ordering/atomicity, not just that a BadRequestException short-circuits before any DDL runs.
      await ctx.dataSource.query(`CREATE TABLE public.purge_fail_dummy (id int)`);
      await ctx.dataSource.query(`ALTER TABLE public.purge_fail_dummy OWNER TO "${roleName}"`);

      try {
        await expect(tenantsService.purgeTenant(hospitalId, hospitalId)).rejects.toThrow();

        const registryRow = await ctx.dataSource.query(
          `SELECT status FROM tenants WHERE "hospitalId" = $1`,
          [hospitalId],
        );
        expect(registryRow[0].status).toBe('archived');

        const [schemaRow] = await ctx.dataSource.query(
          `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
          [`tenant_${hospitalId}`],
        );
        expect(schemaRow).toBeDefined();
      } finally {
        await ctx.dataSource.query(`DROP TABLE IF EXISTS public.purge_fail_dummy`);
      }
    });
  });
});
