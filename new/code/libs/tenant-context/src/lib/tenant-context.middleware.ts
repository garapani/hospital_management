import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type {} from '@hospital/auth-guards';
import { TenantContextService } from './tenant-context.service.js';

// The only two routes where AuthContextMiddleware never runs (see its own .exclude() list), so
// header-based fallback here is expected, not suspicious — matched by suffix since this list is
// prefix-agnostic to main.ts's app.setGlobalPrefix('api').
const EXPECTED_FALLBACK_PATH_SUFFIXES = ['/auth/login', '/auth/refresh'];

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);
  
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // req.authContext is set by AuthContextMiddleware, which runs first on every route except
    // POST /auth/login and POST /auth/refresh (excluded — no prior JWT can exist at login, and
    // refresh derives its own tenant from the refresh token's own claim). Keying the fallback on
    // the presence of req.authContext itself (rather than per-field truthiness) guarantees headers
    // are never consulted once AuthContextMiddleware has run, even if it somehow produced an
    // authContext with a falsy hospitalId/accountId — that fallback is ONLY ever reached on those
    // two excluded routes, never on an authenticated one.
    const tenantId = req.authContext ? req.authContext.hospitalId : (req.header('x-tenant-id') || undefined);
    const accountId = req.authContext ? req.authContext.accountId : (req.header('x-account-id') || undefined);
    
    // Log when header fallback is used on any route other than the two where it's expected —
    // that's the actual anomaly worth security monitoring; login/refresh fall back on every call
    // by design (see the comment above) and would otherwise drown this out. Uses originalUrl, not
    // path, since path was observed to report the pre-global-prefix-stripped value here ('/').
    const originalUrl = req.originalUrl.split('?')[0];
    const isExpectedFallbackRoute = EXPECTED_FALLBACK_PATH_SUFFIXES.some((suffix) => originalUrl.endsWith(suffix));
    if (!req.authContext && !isExpectedFallbackRoute && (req.header('x-tenant-id') || req.header('x-account-id'))) {
      this.logger.warn(`Tenant context fallback to headers detected for path: ${originalUrl}, tenantId: ${req.header('x-tenant-id')}`);
    }
    
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () =>
      next(),
    );
  }
}
