import { Logger } from '@nestjs/common';
import { TenantContextMiddleware } from './tenant-context.middleware.js';
import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextMiddleware', () => {
  function buildRequest(
    headers: Record<string, string | undefined>,
    authContext?: { hospitalId?: string; accountId?: string },
    originalUrl = '/api/auth/refresh',
  ) {
    return { header: (name: string) => headers[name], authContext, originalUrl } as any;
  }

  it('propagates tenant id and account id from req.authContext when present, ignoring headers', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest(
      { 'x-tenant-id': 'header-tenant', 'x-account-id': 'header-account', 'x-correlation-id': 'corr-1' },
      { hospitalId: 'h1', accountId: 'acc-1' },
    );

    let observed: unknown;
    middleware.use(req, {} as any, () => {
      observed = {
        tenantId: service.getTenantId(),
        accountId: service.getAccountId(),
        correlationId: service.getCorrelationId(),
      };
    });

    expect(observed).toEqual({
      tenantId: 'h1',
      accountId: 'acc-1',
      correlationId: 'corr-1',
    });
  });

  it('falls back to headers when req.authContext is absent (login/refresh routes only)', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({
      'x-tenant-id': 'h1',
      'x-account-id': 'acc-1',
      'x-correlation-id': 'corr-1',
    });

    let observed: unknown;
    middleware.use(req, {} as any, () => {
      observed = {
        tenantId: service.getTenantId(),
        accountId: service.getAccountId(),
        correlationId: service.getCorrelationId(),
      };
    });

    expect(observed).toEqual({
      tenantId: 'h1',
      accountId: 'acc-1',
      correlationId: 'corr-1',
    });
  });

  it('generates a new correlation id when none is provided', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({});

    let observedCorrelationId: string | undefined;
    middleware.use(req, {} as any, () => {
      observedCorrelationId = service.getCorrelationId();
    });

    expect(observedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never consults x-tenant-id/x-account-id headers when req.authContext is present, even if its fields are falsy', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest(
      { 'x-tenant-id': 'header-tenant', 'x-account-id': 'header-account', 'x-correlation-id': 'corr-1' },
      { hospitalId: undefined, accountId: undefined },
    );

    let observed: unknown;
    middleware.use(req, {} as any, () => {
      observed = {
        tenantId: service.getTenantId(),
        accountId: service.getAccountId(),
        correlationId: service.getCorrelationId(),
      };
    });

    expect(observed).toEqual({
      tenantId: undefined,
      accountId: undefined,
      correlationId: 'corr-1',
    });
  });

  it('does not warn when the header fallback happens on /auth/refresh or /auth/login', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    middleware.use(
      buildRequest({ 'x-tenant-id': 'h1' }, undefined, '/api/auth/refresh'),
      {} as any,
      () => undefined,
    );
    middleware.use(
      buildRequest({ 'x-tenant-id': 'h1' }, undefined, '/api/auth/login'),
      {} as any,
      () => undefined,
    );

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warns when the header fallback happens on any other route', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    middleware.use(
      buildRequest({ 'x-tenant-id': 'h1' }, undefined, '/api/patients'),
      {} as any,
      () => undefined,
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/api/patients'));
    warnSpy.mockRestore();
  });

  it('calls next() even when tenant id and account id are absent from both authContext and headers', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({});
    let nextCalled = false;

    middleware.use(req, {} as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
