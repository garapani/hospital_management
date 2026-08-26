import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { RequestContext } from './request-context.js';

interface AccessTokenPayload {
  sub: string;
  hospitalId: string;
  roles: string[];
  permissions: string[];
  type: string;
  accountType?: 'staff' | 'patient';
  patientId?: string;
}

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.header('authorization');
    if (!authHeader || authHeader.slice(0, 7).toLowerCase() !== 'bearer ') {
      next(new UnauthorizedException('Missing or malformed Authorization header'));
      return;
    }

    const token = authHeader.slice(7);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, { algorithms: ['HS256'] });
    } catch {
      next(new UnauthorizedException('Invalid or expired token'));
      return;
    }

    if (payload.type !== 'access') {
      next(new UnauthorizedException('Token is not an access token'));
      return;
    }

    if (!payload.sub || !payload.hospitalId) {
      next(new UnauthorizedException('Token missing required claims'));
      return;
    }

    const authContext: RequestContext = {
      accountId: payload.sub,
      hospitalId: payload.hospitalId,
      roles: payload.roles,
      permissions: payload.permissions,
      accountType: payload.accountType,
      patientId: payload.patientId,
    };

    req.authContext = authContext;
    next();
  }
}
