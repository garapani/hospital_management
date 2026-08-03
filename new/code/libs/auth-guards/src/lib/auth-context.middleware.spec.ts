import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthContextMiddleware } from './auth-context.middleware.js';

describe('AuthContextMiddleware', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });

  function buildRequest(authorizationHeader: string | undefined) {
    return { header: (name: string) => (name === 'authorization' ? authorizationHeader : undefined) } as any;
  }

  it('attaches req.authContext from a valid access token', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: ['Doctor'], permissions: ['clinical.notes.write'], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let nextCalled = false;

    await middleware.use(req, {} as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.authContext).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
    });
  });

  it('calls next with UnauthorizedException when the Authorization header is missing', async () => {
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(undefined);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the header is not a Bearer token', async () => {
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest('Basic somevalue');
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token signature is invalid', async () => {
    const otherService = new JwtService({ secret: 'a-different-secret' });
    const token = await otherService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token is expired', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
      { expiresIn: '-1s' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token type is refresh, not access', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', type: 'refresh' },
      { expiresIn: '7d' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });
});
