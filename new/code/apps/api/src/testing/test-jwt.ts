import { JwtService } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

export interface TestTokenClaims {
  sub: string;
  hospitalId: string;
  roles?: string[];
  permissions?: string[];
}

export async function signTestToken(claims: TestTokenClaims): Promise<string> {
  const jwtService = new JwtService({ secret: resolveJwtSecret() });
  return jwtService.signAsync(
    {
      sub: claims.sub,
      hospitalId: claims.hospitalId,
      roles: claims.roles ?? [],
      permissions: claims.permissions ?? [],
      type: 'access',
    },
    { expiresIn: '15m' },
  );
}
