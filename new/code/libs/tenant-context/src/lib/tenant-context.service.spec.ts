import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextService', () => {
  it('returns undefined for all fields outside of a run() call', () => {
    const service = new TenantContextService();
    expect(service.getTenantId()).toBeUndefined();
    expect(service.getAccountId()).toBeUndefined();
    expect(service.getCorrelationId()).toBeUndefined();
    expect(service.getSchemaName()).toBeUndefined();
  });

  it('returns the values set for the current run() scope', () => {
    const service = new TenantContextService();
    service.run(
      { tenantId: 'h1', accountId: 'acc-1', correlationId: 'corr-1' },
      () => {
        expect(service.getTenantId()).toBe('h1');
        expect(service.getAccountId()).toBe('acc-1');
        expect(service.getCorrelationId()).toBe('corr-1');
        expect(service.getSchemaName()).toBe('tenant_h1');
      },
    );
  });

  it('isolates context across concurrent async run() calls', async () => {
    const service = new TenantContextService();
    const results: string[] = [];

    await Promise.all([
      service.run({ tenantId: 'h1', correlationId: 'c1' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(service.getTenantId() as string);
      }),
      service.run({ tenantId: 'h2', correlationId: 'c2' }, async () => {
        results.push(service.getTenantId() as string);
      }),
    ]);

    expect(results.sort()).toEqual(['h1', 'h2']);
  });
});
