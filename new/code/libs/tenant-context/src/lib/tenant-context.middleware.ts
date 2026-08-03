import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // req.authContext is set by AuthContextMiddleware (libs/auth-guards), which runs first on
    // every route except POST /auth/login and POST /auth/refresh (excluded — no prior JWT can
    // exist at login, and refresh derives its own tenant from the refresh token's own claim).
    // Falling back to headers here is ONLY ever reached on those two excluded routes, never on
    // an authenticated one.
    //
    // The `Request.authContext` ambient type augmentation lives in
    // `@hospital/auth-guards`'s request-context.ts, and this lib intentionally has no
    // compile-time dependency on that lib (tenant-context is a lower-level primitive), so the
    // global declaration merge isn't visible to this project's isolated `tsc --build`. Read it
    // through a local, narrow type assertion instead of importing the shared `RequestContext`
    // type, to avoid introducing a cross-lib dependency for a single ambient field.
    const authContext = (
      req as Request & { authContext?: { hospitalId?: string; accountId?: string } }
    ).authContext;
    const tenantId = authContext?.hospitalId ?? (req.header('x-tenant-id') || undefined);
    const accountId = authContext?.accountId ?? (req.header('x-account-id') || undefined);
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () =>
      next(),
    );
  }
}
