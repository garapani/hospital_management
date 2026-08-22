import { Controller, Get } from '@nestjs/common';
import { TenantContextService } from '@hospital/tenant-context';
import { PlatformBrandingService } from './platform-branding.service.js';

/**
 * Public, unauthenticated read of the caller's own tenant branding — resolved from the
 * `x-tenant-id` header (the same trust model `AuthContextMiddleware`-excluded routes like
 * `/auth/login` already use), not a JWT. Deliberately excluded from `AuthContextMiddleware`
 * (see `app.module.ts`) so the login page can render branding before any session exists. Read-only
 * and single-tenant by construction — the header only ever names the caller's own tenant, so there
 * is no cross-tenant read surface here to guard against.
 *
 * Deliberately NOT under `tenants/*`: `TenantsController` already owns `GET tenants/:hospitalId`,
 * and NestJS resolves routes in controller-registration order — `tenants/branding` would risk
 * being swallowed by that `:hospitalId` param (matching the literal string `branding`) depending
 * on which module happens to import first. A standalone top-level path sidesteps that class of
 * bug entirely instead of relying on import order staying a specific way forever.
 */
@Controller('branding')
export class TenantBrandingController {
  constructor(
    private readonly brandingService: PlatformBrandingService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  async get() {
    return this.brandingService.getPublicBranding(this.tenantContext.getTenantId());
  }
}
