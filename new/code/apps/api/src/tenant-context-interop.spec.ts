import { TenantContextService } from '@hospital/tenant-context';

// Smoke test: proves apps/api (a CommonJS-by-default app under Nx's
// "nodenext" module resolution) can actually import and execute code from
// @hospital/tenant-context, which is a pure-ESM package (no "require" export
// condition). If apps/api/package.json is missing
// "type": "module", this import resolves fine under ts-jest/SWC transform
// (which doesn't enforce Node's runtime module resolution rules) but would
// fail at real runtime with ERR_REQUIRE_ESM once compiled by tsc. This test
// at least proves the cross-package symbol resolves and behaves correctly.
describe('tenant-context ESM interop', () => {
  it('imports TenantContextService from @hospital/tenant-context and constructs it', () => {
    const service = new TenantContextService();

    expect(service.getTenantId()).toBeUndefined();
  });

  it('resolves tenant id inside a run() context', () => {
    const service = new TenantContextService();

    const result = service.run(
      { tenantId: 'tenant-123', correlationId: 'corr-1' },
      () => service.getTenantId(),
    );

    expect(result).toBe('tenant-123');
  });
});
