import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../database/database.module.js';
import { PackagesModule } from './packages.module.js';
import { PackagesService } from './packages.service.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TenantProvisioningService } from '../database/tenant-provisioning.service.js';
import { Permission } from '../rbac/entities/permission.entity.js';
import { Tenant } from '../tenants/entities/tenant.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
import { AuthService } from '../auth/auth.service.js';

describe('SaaS packages (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let packagesService: PackagesService;
  let tenantsService: TenantsService;
  let platformToken: string;
  let allPermissionNames: string[];

  /** Directly-inserted registry rows (no schema) — clean up by deleting the row. */
  const registryOnlyTenantIds: string[] = [];

  async function insertTenantRow(hospitalId: string, packageCode: string): Promise<void> {
    await ctx.dataSource.getRepository(Tenant).save(
      ctx.dataSource.getRepository(Tenant).create({
        hospitalId,
        hospitalName: `Package Test ${hospitalId}`,
        status: 'active',
        packageCode,
        activatedAt: new Date(),
        suspendedAt: null,
        createdBy: 'packages-spec',
      }),
    );
    registryOnlyTenantIds.push(hospitalId);
  }

  /** Fully-provisioned tenants (schema + role + registry row) — drop all three. */
  async function dropProvisionedTenant(hospitalId: string): Promise<void> {
    await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${hospitalId}" CASCADE`);
    await ctx.dataSource.query(`DROP ROLE IF EXISTS "tenant_${hospitalId}"`);
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [hospitalId]);
  }

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'packages', seedRbac: true });
    packagesService = new PackagesService(ctx.dataSource);
    tenantsService = new TenantsService(
      ctx.dataSource,
      new TenantProvisioningService(ctx.dataSource),
      ctx.tenantConnection,
      ctx.tenantContext,
      packagesService,
    );

    platformToken = await signTestToken({
      sub: 'packages-spec-admin',
      hospitalId: ctx.tenantId,
      permissions: ['system-admin.tenants.manage'],
    });

    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, PackagesModule, TenantsModule],
    })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const jwtService = new JwtService({ secret: resolveJwtSecret() });
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(new AuthContextMiddleware(jwtService).use.bind(new AuthContextMiddleware(jwtService)));
    await app.init();

    allPermissionNames = (await ctx.dataSource.getRepository(Permission).find()).map((p) => p.name);
  });

  afterAll(async () => {
    // Cleanup must run before app.close(): the app's DatabaseModule owns (and destroys) the
    // overridden DataSource on close, so any query after close() hits a dead connection.
    for (const hospitalId of registryOnlyTenantIds) {
      await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [hospitalId]);
    }
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  describe('PackagesService.filterPermissions', () => {
    it('grants Basic-package modules and hides Standard/Enterprise ones', async () => {
      await insertTenantRow('test_pkg_svc_basic', 'basic');
      const filtered = await packagesService.filterPermissions('test_pkg_svc_basic', allPermissionNames);

      // Basic keeps the MVP core — including radiology, employee and payroll (moved down 2026-08-21).
      expect(filtered).toContain('patients.read');
      expect(filtered).toContain('lab.read');
      expect(filtered).toContain('radiology.read');
      expect(filtered).toContain('pharmacy.read');
      expect(filtered).toContain('employee.manage');
      expect(filtered).toContain('payroll.read');
      // Always-on infrastructure permissions survive in every package.
      expect(filtered).toContain('identity.accounts.manage');
      expect(filtered).toContain('master-data.manage');
      // Standard/Enterprise modules are hidden.
      expect(filtered).not.toContain('insurance.read');
      expect(filtered).not.toContain('accounting.manage');
      expect(filtered).not.toContain('fixed-asset.read');
      expect(filtered).not.toContain('ward-supply.read');
      expect(filtered).not.toContain('nursing.manage');
      expect(filtered).not.toContain('helpdesk.manage');
    });

    it('upgrade to Standard adds ward/nursing/fixed-assets but not insurance', async () => {
      await tenantsService.setTenantPackage('test_pkg_svc_basic', 'standard');
      const filtered = await packagesService.filterPermissions('test_pkg_svc_basic', allPermissionNames);

      expect(filtered).toContain('ward-supply.read');
      expect(filtered).toContain('nursing.manage');
      expect(filtered).toContain('fixed-asset.read');
      expect(filtered).toContain('helpdesk.manage');
      expect(filtered).not.toContain('insurance.read');
      expect(filtered).not.toContain('accounting.manage');
    });

    it('upgrade to Enterprise adds insurance and accounting', async () => {
      await tenantsService.setTenantPackage('test_pkg_svc_basic', 'enterprise');
      const filtered = await packagesService.filterPermissions('test_pkg_svc_basic', allPermissionNames);

      expect(filtered).toContain('insurance.read');
      expect(filtered).toContain('insurance.manage');
      expect(filtered).toContain('accounting.read');
      expect(filtered).toContain('accounting.manage');
    });

    it('downgrade back to Basic revokes the Standard/Enterprise permissions', async () => {
      await tenantsService.setTenantPackage('test_pkg_svc_basic', 'basic');
      const filtered = await packagesService.filterPermissions('test_pkg_svc_basic', allPermissionNames);

      expect(filtered).not.toContain('ward-supply.read');
      expect(filtered).not.toContain('insurance.read');
      expect(filtered).not.toContain('accounting.manage');
    });

    it('never filters the platform tenant (cross-tenant ops)', async () => {
      const filtered = await packagesService.filterPermissions(PLATFORM_TENANT_ID, allPermissionNames);
      expect(filtered).toEqual(allPermissionNames);
    });

    it('fails open for a tenant with no registry row (test contexts, unknown codes)', async () => {
      const filtered = await packagesService.filterPermissions('no_such_registry_row', allPermissionNames);
      expect(filtered).toEqual(allPermissionNames);
    });

    it('hides permissions that belong to no package module', async () => {
      const filtered = await packagesService.filterPermissions('test_pkg_svc_basic', [
        'lab.read',
        'mystery.read',
        'system.config.manage',
      ]);
      expect(filtered).toEqual(['lab.read', 'system.config.manage']);
    });
  });

  describe('HTTP endpoints', () => {
    it('GET /api/packages lists the three seeded tiers', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/packages')
        .set('Authorization', `Bearer ${platformToken}`);

      expect(response.status).toBe(200);
      expect(response.body.map((p: { code: string }) => p.code).sort()).toEqual([
        'basic',
        'enterprise',
        'standard',
      ]);
      expect(response.body[0].modules).toContain('lab');
    });

    it('POST /api/tenants stores the chosen packageCode', async () => {
      const hospitalId = 'test_pkg_http_std';
      const response = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ hospitalId, hospitalName: 'Standard Hospital', packageCode: 'standard' });

      expect(response.status).toBe(201);
      expect(response.body.packageCode).toBe('standard');
      await dropProvisionedTenant(hospitalId);
    });

    it('POST /api/tenants defaults to basic and rejects an unknown packageCode', async () => {
      const defaulted = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ hospitalId: 'test_pkg_http_def', hospitalName: 'Default Hospital' });
      expect(defaulted.status).toBe(201);
      expect(defaulted.body.packageCode).toBe('basic');
      await dropProvisionedTenant('test_pkg_http_def');

      const rejected = await request(app.getHttpServer())
        .post('/api/tenants')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ hospitalId: 'test_pkg_http_bad', hospitalName: 'Bad Hospital', packageCode: 'platinum' });
      expect(rejected.status).toBe(400);
      expect(rejected.body.message).toMatch(/Unknown packageCode/);
    });

    it('PATCH /api/tenants/:hospitalId/package changes the tier', async () => {
      await insertTenantRow('test_pkg_http_patch', 'basic');
      const response = await request(app.getHttpServer())
        .patch('/api/tenants/test_pkg_http_patch/package')
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ packageCode: 'enterprise' });

      expect(response.status).toBe(200);
      expect(response.body.packageCode).toBe('enterprise');
    });
  });

  describe('package-driven default roles', () => {
    it('provisions the package role set and adds the new package roles on upgrade', async () => {
      const hospitalId = 'test_pkg_roles';
      await tenantsService.provisionTenant({
        hospitalId,
        hospitalName: 'Roles Hospital',
        packageCode: 'basic',
        createdBy: 'packages-spec',
      });

      const enabledNames = async () => {
        const rows: { name: string }[] = await ctx.dataSource.query(
          `SELECT r.name FROM tenant_roles tr JOIN roles r ON r.id = tr."roleId"
           WHERE tr."tenantId" = $1 ORDER BY r.name`,
          [hospitalId],
        );
        return rows.map((row) => row.name);
      };

      const basicRoles = await enabledNames();
      expect(basicRoles).toContain('Hospital Admin');
      expect(basicRoles).toContain('Lab Technician');
      expect(basicRoles).toContain('Billing/Accounts Staff');
      // Standard/Enterprise-only roles are not enabled by Basic, and the cross-tenant
      // Super Admin role is never auto-enabled for a customer tenant.
      expect(basicRoles).not.toContain('Helpdesk Agent');
      expect(basicRoles).not.toContain('Patient');
      expect(basicRoles).not.toContain('Super Admin');

      await tenantsService.setTenantPackage(hospitalId, 'standard');
      const standardRoles = await enabledNames();
      expect(standardRoles).toContain('Helpdesk Agent');
      expect(standardRoles).not.toContain('Patient');

      await dropProvisionedTenant(hospitalId);
    });
  });

  describe('end-to-end login (JWT permission list follows the package)', () => {
    it('a Basic tenant never receives Enterprise permissions, and an upgrade grants them at next login', async () => {
      const hospitalId = 'test_pkg_login';
      await tenantsService.provisionTenant({
        hospitalId,
        hospitalName: 'Login Hospital',
        packageCode: 'basic',
        createdBy: 'packages-spec',
      });
      await ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'pkg-login' }, () =>
        ctx.accountsService.createStaffAccount({
          username: 'pkg.admin',
          email: 'pkgadmin@example.com',
          displayName: 'Pkg Admin',
          password: 'pkg-password-123',
          roleName: 'Hospital Admin',
        }),
      );

      const jwtService = new JwtService({ secret: resolveJwtSecret() });
      const authService = new AuthService(ctx.accountsService, jwtService, ctx.tenantContext, packagesService);

      const loginBasic = await ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'pkg-login' }, () =>
        authService.login({ username: 'pkg.admin', password: 'pkg-password-123' }),
      );
      const decodedBasic = jwtService.decode((loginBasic as { accessToken: string }).accessToken) as {
        permissions: string[];
      };
      expect(decodedBasic.permissions).toContain('lab.read');
      expect(decodedBasic.permissions).not.toContain('insurance.read');
      expect(decodedBasic.permissions).not.toContain('ward-supply.read');

      await tenantsService.setTenantPackage(hospitalId, 'enterprise');
      const loginEnterprise = await ctx.tenantContext.run({ tenantId: hospitalId, correlationId: 'pkg-login' }, () =>
        authService.login({ username: 'pkg.admin', password: 'pkg-password-123' }),
      );
      const decodedEnterprise = jwtService.decode(
        (loginEnterprise as { accessToken: string }).accessToken,
      ) as { permissions: string[] };
      expect(decodedEnterprise.permissions).toContain('insurance.read');
      expect(decodedEnterprise.permissions).toContain('ward-supply.read');

      await dropProvisionedTenant(hospitalId);
    });
  });
});
