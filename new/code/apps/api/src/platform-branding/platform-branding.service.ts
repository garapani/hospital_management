import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ObjectStorageService } from '@hospital/object-storage';
import { TenantsService } from '../tenants/tenants.service.js';
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
import { TenantBranding } from './entities/tenant-branding.entity.js';
import { UpsertBrandingDto } from './dto/upsert-branding.dto.js';
import { withAdvisoryLock } from '../database/advisory-lock.util.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Also enforced at the multer interceptor level (`platform-branding.controller.ts`) so an
 *  oversized upload is rejected before the whole file is buffered into memory, not after. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB
// SVG deliberately excluded: it's XML and can embed <script>, and this service only checks the
// client-declared mimetype (never inspects file content) before writing that same value back as
// the object's Content-Type — an uploaded SVG would be stored XSS against anyone who opens the
// presigned logo URL directly.
const ALLOWED_LOGO_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const LOGO_URL_EXPIRY_SECONDS = 3600;

export interface UploadedLogoFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/** Public read shape — what the tenant console (login page, shell) actually renders. Never
 *  exposes `logoObjectKey` (an internal storage path), only a resolved, short-lived URL. */
export interface PublicBranding {
  displayName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  tagline: string | null;
  description: string | null;
  footerText: string | null;
  supportText: string | null;
}

/** Fields that follow the same "blank string is invalid, null clears it" rule as displayName. */
const BLANK_CHECKED_TEXT_FIELDS = ['displayName', 'tagline', 'description', 'footerText', 'supportText'] as const;

@Injectable()
export class PlatformBrandingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantsService: TenantsService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  private get repository() {
    return this.dataSource.getRepository(TenantBranding);
  }

  /** Rejects the platform tenant (never brandable), an unknown hospitalId, and inactive tenants (except suspended). */
  private async assertBrandableTenant(hospitalId: string): Promise<void> {
    await this.tenantsService.assertValidHospitalTenant(hospitalId, ['active', 'suspended'], 'be branded');
  }

  private async resolveLogoUrl(row: TenantBranding | null): Promise<string | null> {
    if (!row?.logoObjectKey) {
      return null;
    }
    return this.objectStorage.presignedGetUrl(
      row.tenantId,
      row.logoObjectKey,
      LOGO_URL_EXPIRY_SECONDS,
    );
  }

  /** Shared response shape for both the admin and public reads — only the pre-check differs
   *  (assert-brandable-or-throw vs. degrade-to-null). */
  private async toPublicBranding(row: TenantBranding | null): Promise<PublicBranding> {
    return {
      displayName: row?.displayName ?? null,
      primaryColor: row?.primaryColor ?? null,
      logoUrl: await this.resolveLogoUrl(row),
      tagline: row?.tagline ?? null,
      description: row?.description ?? null,
      footerText: row?.footerText ?? null,
      supportText: row?.supportText ?? null,
    };
  }

  // Serializes upsertBranding/uploadLogo/removeLogo for one tenant: `tenantId` is this table's
  // primary key, so two concurrent first-time writes (e.g. a double-clicked Save, or two open
  // admin tabs) could otherwise both see "no row yet" and both attempt an INSERT — the second
  // hits a raw primary-key violation instead of a clean update. Same transaction-scoped pattern
  // as billing's per-tenant lock (`subscription-billing.service.ts`, `Development-Standards.md`
  // §48's post-review hardening) and charge-capture's per-patient lock (§27).
  private lockBrandingRow(manager: EntityManager, hospitalId: string): Promise<void> {
    return withAdvisoryLock(manager, `platform_branding:${hospitalId}`);
  }

  private async getOrCreateBrandingRow(
    manager: EntityManager,
    hospitalId: string,
  ): Promise<TenantBranding> {
    const existing = await manager.getRepository(TenantBranding).findOne({ where: { tenantId: hospitalId } });
    return existing ?? manager.getRepository(TenantBranding).create({ tenantId: hospitalId });
  }

  /** Platform-admin read: the raw row (or nulls if unconfigured) plus a resolved logo URL. */
  async getBrandingForAdmin(hospitalId: string): Promise<PublicBranding> {
    await this.assertBrandableTenant(hospitalId);
    const row = await this.repository.findOne({ where: { tenantId: hospitalId } });
    return this.toPublicBranding(row);
  }

  /** Public, unauthenticated read (login page + tenant console shell) — the platform tenant and
   *  any tenant with no configured branding both resolve to all-null, which the frontend renders
   *  as the default Vaidya brand. Never throws: an unknown/mistyped tenant header should degrade
   *  to the default brand, not break the login page. */
  async getPublicBranding(hospitalId: string | undefined): Promise<PublicBranding> {
    if (!hospitalId || hospitalId === PLATFORM_TENANT_ID) {
      return this.toPublicBranding(null);
    }
    const row = await this.repository.findOne({ where: { tenantId: hospitalId } });
    return this.toPublicBranding(row);
  }

  async upsertBranding(hospitalId: string, dto: UpsertBrandingDto): Promise<TenantBranding> {
    await this.assertBrandableTenant(hospitalId);
    if (dto.primaryColor !== undefined && dto.primaryColor !== null && !HEX_COLOR.test(dto.primaryColor)) {
      throw new BadRequestException('primaryColor must be a 6-digit hex color, e.g. #006D77');
    }
    for (const field of BLANK_CHECKED_TEXT_FIELDS) {
      const value = dto[field];
      if (value !== undefined && value !== null && !value.trim()) {
        throw new BadRequestException(`${field} cannot be blank — pass null to clear it`);
      }
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lockBrandingRow(manager, hospitalId);
      const row = await this.getOrCreateBrandingRow(manager, hospitalId);
      for (const field of BLANK_CHECKED_TEXT_FIELDS) {
        const value = dto[field];
        if (value !== undefined) {
          row[field] = value?.trim() ?? null;
        }
      }
      if (dto.primaryColor !== undefined) {
        row.primaryColor = dto.primaryColor;
      }
      return manager.getRepository(TenantBranding).save(row);
    });
  }

  async uploadLogo(hospitalId: string, file: UploadedLogoFile): Promise<TenantBranding> {
    await this.assertBrandableTenant(hospitalId);
    const extension = ALLOWED_LOGO_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Unsupported logo type ${file.mimetype}; allowed: ${Object.keys(ALLOWED_LOGO_MIME_TYPES).join(', ')}`,
      );
    }
    if (file.size > MAX_LOGO_BYTES) {
      throw new BadRequestException(`Logo exceeds the ${MAX_LOGO_BYTES / 1024 / 1024}MB limit`);
    }

    return this.dataSource.transaction(async (manager) => {
      await this.lockBrandingRow(manager, hospitalId);
      const row = await this.getOrCreateBrandingRow(manager, hospitalId);
      const previousKey = row.logoObjectKey;
      const key = `branding/logo.${extension}`;
      await this.objectStorage.putObject(hospitalId, key, file.buffer, file.size, {
        'Content-Type': file.mimetype,
      });
      // A different extension than last time (e.g. .png replaced by .webp) would otherwise leave
      // the old object orphaned in the bucket — best-effort cleanup, never blocks the upload.
      if (previousKey && previousKey !== key) {
        await this.objectStorage.removeObject(hospitalId, previousKey).catch(() => undefined);
      }
      row.logoObjectKey = key;
      return manager.getRepository(TenantBranding).save(row);
    });
  }

  async removeLogo(hospitalId: string): Promise<TenantBranding> {
    await this.assertBrandableTenant(hospitalId);
    return this.dataSource.transaction(async (manager) => {
      await this.lockBrandingRow(manager, hospitalId);
      const row = await manager.getRepository(TenantBranding).findOne({ where: { tenantId: hospitalId } });
      if (!row?.logoObjectKey) {
        throw new NotFoundException(`Tenant ${hospitalId} has no logo configured`);
      }
      await this.objectStorage.removeObject(hospitalId, row.logoObjectKey).catch(() => undefined);
      row.logoObjectKey = null;
      return manager.getRepository(TenantBranding).save(row);
    });
  }
}
