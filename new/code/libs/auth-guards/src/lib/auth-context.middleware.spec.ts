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

  it('calls next with UnauthorizedException when a validly-signed access token is missing hospitalId', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', roles: ['Doctor'], permissions: [], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;
    let nextCalledWithoutError = false;

    await middleware.use(req, {} as any, (err?: unknown) => {
      if (err) {
        capturedError = err;
      } else {
        nextCalledWithoutError = true;
      }
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
    expect(nextCalledWithoutError).toBe(false);
    expect(req.authContext).toBeUndefined();
  });

  it('calls next with UnauthorizedException when a validly-signed access token is missing sub', async () => {
    const token = await jwtService.signAsync(
      { hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
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

  it('accepts a lowercase "bearer" scheme prefix (case-insensitive per RFC 7235)', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`bearer ${token}`);
    let nextCalled = false;

    await middleware.use(req, {} as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.authContext).toMatchObject({ accountId: 'acc-1', hospitalId: 'h1' });
  });

  it('rejects a token signed with a different algorithm than the pinned HS256', async () => {
    // Sign a token whose header claims 'none' but which JwtService (HS256-only) would otherwise
    // need to explicitly reject rather than silently accept via alg confusion.
    const middleware = new AuthContextMiddleware(jwtService);
    const forgedHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' }),
    ).toString('base64url');
    const forgedToken = `${forgedHeader}.${forgedPayload}.`;
    const req = buildRequest(`Bearer ${forgedToken}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });
});
