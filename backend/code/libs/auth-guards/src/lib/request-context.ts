import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  accountId?: string;
  hospitalId?: string;
  roles: string[];
  permissions: string[];
  accountType?: 'staff' | 'patient';
  patientId?: string;
}

declare module 'express' {
  interface Request {
    authContext?: RequestContext;
  }
}

@Injectable()
export class RequestContextFactory {
  fromRequest(req: Request): RequestContext {
    if (!req.authContext) {
      // AuthContextMiddleware populates req.authContext on every route except the excluded
      // POST /auth/login and POST /auth/refresh — this factory has no legitimate use on those,
      // so a missing authContext here is a caller error, not a route to trust request headers.
      throw new UnauthorizedException('Request has no authContext');
    }
    return req.authContext;
  }
}
