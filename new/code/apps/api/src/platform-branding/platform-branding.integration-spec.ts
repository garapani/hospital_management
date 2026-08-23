import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { PlatformBrandingModule } from './platform-branding.module.js';
import { MAX_LOGO_BYTES, PlatformBrandingService } from './platform-branding.service.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

// tenant_branding is a shared platform table — prefix + clean up like the other shared-table specs
// (subscription-billing, packages).
const PREFIX = 'test_branding_';

describe('PlatformBranding (integration)', () => {
  let ctx: TenantTestContext;
  let service: PlatformBrandingService;
  let app: INestApplication;
  let noPermissionToken: string;
  let platformToken: string;

  const cleanup = async () => {
    await ctx.dataSource.query(`DELETE FROM tenant_branding WHERE "tenantId" LIKE '${PREFIX}%'`);
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" LIKE '${PREFIX}%'`);
  };

  const provision = (hospitalId: string) =>
    ctx.dataSource.query(
      `INSERT INTO tenants ("hospitalId", "hospitalName", "status", "packageCode", "createdBy", "activatedAt")
       VALUES ($1, 'Branding Test Hospital', 'active', 'basic', 'branding-spec', NOW())`,
      [hospitalId],
    );

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'branding_svc', seedRbac: true });
    await cleanup();

    noPermissionToken = await signTestToken({ sub: 'branding-http-user', hospitalId: ctx.tenantId });
    platformToken = await signTestToken({
      sub: 'branding-http-platform',
      hospitalId: ctx.tenantId,
      permissions: ['system-admin.tenants.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [PlatformBrandingModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    service = moduleRef.get(PlatformBrandingService);

    const tenantContext = moduleRef.get(TenantContextService);
    app = moduleRef.createNestApplication();
    const jwtService = new JwtService({ secret: resolveJwtSecret() });
    const authContextMiddleware = new AuthContextMiddleware(jwtService);
    app.use(authContextMiddleware.use.bind(authContextMiddleware));
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await cleanup();
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  describe('service', () => {
    it('returns all-null for an unconfigured tenant (frontend default-Vaidya-brand case)', async () => {
      const hospitalId = `${PREFIX}unconfigured`;
      await provision(hospitalId);
      const result = await service.getBrandingForAdmin(hospitalId);
      expect(result).toEqual({ displayName: null, primaryColor: null, logoUrl: null });
    });

    it('the platform tenant always resolves to all-null, never a row lookup', async () => {
      const result = await service.getPublicBranding(PLATFORM_TENANT_ID);
      expect(result).toEqual({ displayName: null, primaryColor: null, logoUrl: null });
    });

    it('an unknown/undefined tenant header resolves to all-null instead of throwing', async () => {
      await expect(service.getPublicBranding(undefined)).resolves.toEqual({
        displayName: null,
        primaryColor: null,
        logoUrl: null,
      });
      await expect(service.getPublicBranding('no_such_tenant')).resolves.toEqual({
        displayName: null,
        primaryColor: null,
        logoUrl: null,
      });
    });

    it('upserts displayName and primaryColor, and the public read reflects it', async () => {
      const hospitalId = `${PREFIX}upsert`;
      await provision(hospitalId);

      const saved = await service.upsertBranding(hospitalId, {
        displayName: 'City Hospital',
        primaryColor: '#123ABC',
      });
      expect(saved.displayName).toBe('City Hospital');
      expect(saved.primaryColor).toBe('#123ABC');

      const publicView = await service.getPublicBranding(hospitalId);
      expect(publicView).toEqual({
        displayName: 'City Hospital',
        primaryColor: '#123ABC',
        logoUrl: null,
      });
    });

    it('null explicitly clears a field back to default; omitted leaves it unchanged', async () => {
      const hospitalId = `${PREFIX}clear`;
      await provision(hospitalId);
      await service.upsertBranding(hospitalId, { displayName: 'Temp Name', primaryColor: '#006D77' });

      const afterClearName = await service.upsertBranding(hospitalId, { displayName: null });
      expect(afterClearName.displayName).toBeNull();
      expect(afterClearName.primaryColor).toBe('#006D77'); // untouched (omitted)
    });

    it('rejects a malformed primaryColor and a blank displayName', async () => {
      const hospitalId = `${PREFIX}validate`;
      await provision(hospitalId);
      await expect(
        service.upsertBranding(hospitalId, { primaryColor: 'teal' }),
      ).rejects.toThrow('hex color');
      await expect(service.upsertBranding(hospitalId, { displayName: '   ' })).rejects.toThrow(
        'cannot be blank',
      );
    });

    it('rejects branding for the platform tenant and an unknown tenant', async () => {
      await expect(
        service.upsertBranding(PLATFORM_TENANT_ID, { displayName: 'x' }),
      ).rejects.toThrow('reserved system tenant');
      await expect(
        service.upsertBranding('no_such_tenant', { displayName: 'x' }),
      ).rejects.toThrow('not found');
    });

    it('rejects operations on archived tenants but allows them on suspended tenants', async () => {
      const suspendedId = `${PREFIX}suspended`;
      const archivedId = `${PREFIX}archived`;
      await provision(suspendedId);
      await provision(archivedId);

      await ctx.dataSource.query(`UPDATE tenants SET status = 'suspended' WHERE "hospitalId" = $1`, [suspendedId]);
      await ctx.dataSource.query(`UPDATE tenants SET status = 'archived' WHERE "hospitalId" = $1`, [archivedId]);

      // Suspended should succeed
      const saved = await service.upsertBranding(suspendedId, { displayName: 'Suspended Hospital' });
      expect(saved.displayName).toBe('Suspended Hospital');
      
      const uploaded = await service.uploadLogo(suspendedId, { buffer: Buffer.from('fake'), mimetype: 'image/png', size: 4 });
      expect(uploaded.logoObjectKey).not.toBeNull();
      
      await service.removeLogo(suspendedId);

      // Archived should fail
      await expect(
        service.upsertBranding(archivedId, { displayName: 'x' })
      ).rejects.toThrow(/must have status active, suspended/);

      await expect(
        service.uploadLogo(archivedId, { buffer: Buffer.from('fake'), mimetype: 'image/png', size: 4 })
      ).rejects.toThrow(/must have status active, suspended/);

      // Need to configure a logo for the archived tenant to test removeLogo correctly
      await ctx.dataSource.query(
        `INSERT INTO tenant_branding ("tenantId", "logoObjectKey") VALUES ($1, 'branding/logo.png')`,
        [archivedId],
      );
      await expect(service.removeLogo(archivedId)).rejects.toThrow(/must have status active, suspended/);
    });

    it('uploads a logo, resolves a URL for it, then removes it', async () => {
      const hospitalId = `${PREFIX}logo`;
      await provision(hospitalId);

      const uploaded = await service.uploadLogo(hospitalId, {
        buffer: Buffer.from('fake-png-bytes'),
        mimetype: 'image/png',
        size: 14,
      });
      expect(uploaded.logoObjectKey).toBe('branding/logo.png');

      const admin = await service.getBrandingForAdmin(hospitalId);
      expect(admin.logoUrl).toContain(`${hospitalId}/branding/logo.png`);
      expect(admin.logoUrl).toMatch(/^https?:\/\//);

      const removed = await service.removeLogo(hospitalId);
      expect(removed.logoObjectKey).toBeNull();
    });

    it('rejects an unsupported logo mime type and an oversized file', async () => {
      const hospitalId = `${PREFIX}logo_reject`;
      await provision(hospitalId);
      await expect(
        service.uploadLogo(hospitalId, { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1 }),
      ).rejects.toThrow('Unsupported logo type');
      await expect(
        service.uploadLogo(hospitalId, {
          buffer: Buffer.alloc(3 * 1024 * 1024),
          mimetype: 'image/png',
          size: 3 * 1024 * 1024,
        }),
      ).rejects.toThrow('exceeds');
    });

    it('concurrent first-time upsertBranding calls for the same tenant both succeed (no raw primary-key violation)', async () => {
      const hospitalId = `${PREFIX}race`;
      await provision(hospitalId);

      const results = await Promise.allSettled([
        service.upsertBranding(hospitalId, { displayName: 'First' }),
        service.upsertBranding(hospitalId, { displayName: 'Second' }),
      ]);

      // Both serialize through the advisory lock and succeed as an insert-then-update, in
      // whichever order they happened to acquire the lock — neither should reject.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const final = await service.getBrandingForAdmin(hospitalId);
      expect(['First', 'Second']).toContain(final.displayName);
    });
  });

  describe('HTTP permission gating', () => {
    it('rejects every admin branding route with 403 without system-admin.tenants.manage', async () => {
      const hospitalId = `${PREFIX}http_noperm`;
      await provision(hospitalId);
      const routes = [
        ['get', `/platform/tenants/${hospitalId}/branding`],
        ['put', `/platform/tenants/${hospitalId}/branding`],
        ['delete', `/platform/tenants/${hospitalId}/branding/logo`],
      ] as const;
      for (const [method, path] of routes) {
        const response = await request(app.getHttpServer())
          [method](path)
          .set('Authorization', `Bearer ${noPermissionToken}`)
          .send(method === 'put' ? { displayName: 'x' } : undefined);
        expect(response.status).toBe(403);
      }
    });

    it('reads and updates branding end to end with the platform permission', async () => {
      const hospitalId = `${PREFIX}http_admin`;
      await provision(hospitalId);

      const empty = await request(app.getHttpServer())
        .get(`/platform/tenants/${hospitalId}/branding`)
        .set('Authorization', `Bearer ${platformToken}`);
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual({ displayName: null, primaryColor: null, logoUrl: null });

      const updated = await request(app.getHttpServer())
        .put(`/platform/tenants/${hospitalId}/branding`)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ displayName: 'City Hospital', primaryColor: '#006D77' });
      expect(updated.status).toBe(200);
      expect(updated.body.displayName).toBe('City Hospital');
    });

    it('rejects a logo upload over the size limit at the multer layer, not just the service check', async () => {
      const hospitalId = `${PREFIX}http_toolarge`;
      await provision(hospitalId);

      const response = await request(app.getHttpServer())
        .post(`/platform/tenants/${hospitalId}/branding/logo`)
        .set('Authorization', `Bearer ${platformToken}`)
        .attach('file', Buffer.alloc(MAX_LOGO_BYTES + 1024), { filename: 'logo.png', contentType: 'image/png' });

      // Multer's own limits.fileSize rejects this before the request body is ever fully
      // buffered — a 500 here would mean the interceptor-level cap regressed to relying solely
      // on the service-layer check (the actual bug this test guards against).
      expect(response.status).not.toBe(500);
      expect([400, 413]).toContain(response.status);
    });
  });
});
