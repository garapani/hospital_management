import { isExpectedUnauthenticatedFallback } from './unauthenticated-routes.js';

describe('isExpectedUnauthenticatedFallback', () => {
  it('suppresses the fallback warning for the public branding route, with or without the global prefix', () => {
    expect(isExpectedUnauthenticatedFallback('/branding')).toBe(true);
    expect(isExpectedUnauthenticatedFallback('/api/branding')).toBe(true);
  });

  it('3.7: does NOT suppress the warning for the JWT-protected admin branding route, even though it also ends in "/branding"', () => {
    // The exact collision this consolidation was built to fix: a naive suffix match on
    // '/branding' would silently swallow a real tenant-context-spoofing warning here.
    expect(isExpectedUnauthenticatedFallback('/platform/tenants/h1/branding')).toBe(false);
    expect(isExpectedUnauthenticatedFallback('/api/platform/tenants/h1/branding')).toBe(false);
  });

  it('suppresses the warning for the other known unauthenticated routes', () => {
    expect(isExpectedUnauthenticatedFallback('/api/auth/login')).toBe(true);
    expect(isExpectedUnauthenticatedFallback('/api/auth/refresh')).toBe(true);
    expect(isExpectedUnauthenticatedFallback('/api/auth/change-password')).toBe(true);
    expect(isExpectedUnauthenticatedFallback('/api/metrics')).toBe(true);
  });

  it('does not suppress the warning for an unrelated route sharing a suffix with a known one', () => {
    // Same class of bug as the branding collision, generalized: a route that merely ENDS with
    // one of the known suffixes (e.g. a hypothetical nested ".../tenant-metrics") must not match.
    expect(isExpectedUnauthenticatedFallback('/api/reporting/tenant-metrics')).toBe(false);
    expect(isExpectedUnauthenticatedFallback('/api/some/nested/auth/login')).toBe(false);
  });

  it('ignores a query string when matching', () => {
    expect(isExpectedUnauthenticatedFallback('/api/branding?tenantId=h1')).toBe(true);
  });
});
