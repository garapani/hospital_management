import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type {} from '@hospital/auth-guards';
import { TenantContextService } from './tenant-context.service.js';

import { isExpectedUnauthenticatedFallback } from './unauthenticated-routes.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);
  
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // req.authContext is set by AuthContextMiddleware, which runs first on every route except
    // those excluded in UNAUTHENTICATED_ROUTES (app.module.ts). Keying the fallback on the
    // presence of req.authContext itself (rather than per-field truthiness) guarantees headers
    // are never consulted once AuthContextMiddleware has run, even if it somehow produced an
    // authContext with a falsy hospitalId/accountId.
    const tenantId = req.authContext ? req.authContext.hospitalId : (req.header('x-tenant-id') || undefined);
    const accountId = req.authContext ? req.authContext.accountId : (req.header('x-account-id') || undefined);
    // patientId/wardId have no unauthenticated-route meaning (unlike tenantId/accountId, which
    // the login flow itself needs pre-auth) — they come from the verified JWT only, never a
    // client header.
    const patientId = req.authContext?.patientId;
    const wardId = req.authContext?.wardId;

    // Log when header fallback is used on any route other than the ones where it's expected —
    // that's the anomaly worth security monitoring.
    const originalUrl = req.originalUrl.split('?')[0];
    const isExpectedFallbackRoute = isExpectedUnauthenticatedFallback(originalUrl);
    if (!req.authContext && !isExpectedFallbackRoute && (req.header('x-tenant-id') || req.header('x-account-id'))) {
      this.logger.warn(`Tenant context fallback to headers detected for path: ${originalUrl}, tenantId: ${req.header('x-tenant-id')}`);
    }
    
    const correlationId = req.header('x-correlation-id') || randomUUID();
    // Echoed back so a client can correlate a failed request against server logs — set here
    // (before any response is sent) so it lands on both success and error responses, including
    // ones the global exception filter formats later in the same request lifecycle.
    res.setHeader('x-correlation-id', correlationId);

    this.tenantContext.run({ tenantId, accountId, patientId, wardId, correlationId }, () =>
      next(),
    );
  }
}
