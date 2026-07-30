import { TenantContextMiddleware } from './tenant-context.middleware.js';
import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextMiddleware', () => {
  function buildRequest(headers: Record<string, string | undefined>) {
    return { header: (name: string) => headers[name] } as any;
  }

  it('propagates tenant id, account id, and an incoming correlation id from headers', () => {
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

    expect(observed).toEqual({ tenantId: 'h1', accountId: 'acc-1', correlationId: 'corr-1' });
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

  it('calls next() even when tenant id and account id headers are absent', () => {
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
