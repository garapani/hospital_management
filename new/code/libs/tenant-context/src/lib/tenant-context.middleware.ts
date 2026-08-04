import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type {} from '@hospital/auth-guards';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // req.authContext is set by AuthContextMiddleware, which runs first on every route except
    // POST /auth/login and POST /auth/refresh (excluded — no prior JWT can exist at login, and
    // refresh derives its own tenant from the refresh token's own claim). Falling back to headers
    // here is ONLY ever reached on those two excluded routes, never on an authenticated one.
    const tenantId = req.authContext?.hospitalId ?? (req.header('x-tenant-id') || undefined);
    const accountId = req.authContext?.accountId ?? (req.header('x-account-id') || undefined);
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () =>
      next(),
    );
  }
}
