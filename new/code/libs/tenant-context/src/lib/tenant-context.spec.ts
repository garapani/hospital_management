import { tenantContext } from './tenant-context.js';

describe('tenantContext', () => {
  it('should work', () => {
    expect(tenantContext()).toEqual('tenant-context');
  });
});
