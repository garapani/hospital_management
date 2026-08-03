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
}

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next(new UnauthorizedException('Missing or malformed Authorization header'));
      return;
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      next(new UnauthorizedException('Invalid or expired token'));
      return;
    }

    if (payload.type !== 'access') {
      next(new UnauthorizedException('Token is not an access token'));
      return;
    }

    const authContext: RequestContext = {
      accountId: payload.sub,
      hospitalId: payload.hospitalId,
      roles: payload.roles,
      permissions: payload.permissions,
    };

    req.authContext = authContext;
    next();
  }
}
