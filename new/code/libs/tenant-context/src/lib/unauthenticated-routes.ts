// Single source of truth for main.ts's app.setGlobalPrefix(...) call, so the fallback matchers
// below (which need to know what a "bare" route path looks like once mounted) can't silently
// drift out of sync with the actual configured prefix the way a hardcoded "at most one prefix
// segment" assumption would if the prefix ever changed shape (e.g. to 'api/v1').
export const API_GLOBAL_PREFIX = 'api';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Matches a URL that is exactly `path`, optionally preceded by the configured global prefix —
 *  not a plain suffix match, which is what let PlatformBrandingController's nested admin route
 *  (`platform/tenants/:hospitalId/branding`) collide with the public `branding` route below. */
function buildPrefixAwareMatcher(path: string): (url: string) => boolean {
  const pattern = new RegExp(`^(/${escapeRegExp(API_GLOBAL_PREFIX)})?/${escapeRegExp(path)}$`);
  return (url) => pattern.test(url);
}

export interface UnauthenticatedRoute {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  matchFallback: (originalUrl: string) => boolean;
}

const ROUTE_PATHS: ReadonlyArray<{ path: string; method: UnauthenticatedRoute['method'] }> = [
  { path: 'auth/login', method: 'POST' },
  { path: 'auth/refresh', method: 'POST' },
  { path: 'auth/change-password', method: 'POST' },
  { path: 'metrics', method: 'GET' },
  // '/branding' can't be a plain suffix match: PlatformBrandingController's JWT-protected admin
  // routes (@Controller('platform/tenants/:hospitalId/branding')) also end in '/branding'.
  // TenantBrandingController's public route is a single top-level segment
  // (@Controller('branding')), so this needs to reject anything with segments between the prefix
  // and 'branding' — which buildPrefixAwareMatcher's anchored-on-both-ends pattern does for every
  // entry here, not just this one.
  { path: 'branding', method: 'GET' },
];

// matchFallback is derived mechanically from `path`, not hand-authored per entry: a hand-written
// matcher is exactly what caused the original branding/admin-route collision (a naive
// .endsWith('/branding') on one entry, correct for every OTHER entry at the time it was written,
// wrong the moment a differently-shaped route happened to share a suffix). Adding a new
// unauthenticated route now only ever requires one line here.
export const UNAUTHENTICATED_ROUTES: readonly UnauthenticatedRoute[] = ROUTE_PATHS.map((route) => ({
  ...route,
  matchFallback: buildPrefixAwareMatcher(route.path),
}));

export function isExpectedUnauthenticatedFallback(originalUrl: string): boolean {
  const urlWithoutQuery = originalUrl.split('?')[0];
  return UNAUTHENTICATED_ROUTES.some((route) => route.matchFallback(urlWithoutQuery));
}
