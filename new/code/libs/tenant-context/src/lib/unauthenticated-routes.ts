export interface UnauthenticatedRoute {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'ALL';
  matchFallback: (originalUrl: string) => boolean;
}

export const UNAUTHENTICATED_ROUTES: readonly UnauthenticatedRoute[] = [
  {
    path: 'auth/login',
    method: 'POST',
    matchFallback: (url) => url.endsWith('/auth/login'),
  },
  {
    path: 'auth/refresh',
    method: 'POST',
    matchFallback: (url) => url.endsWith('/auth/refresh'),
  },
  {
    path: 'auth/change-password',
    method: 'POST',
    matchFallback: (url) => url.endsWith('/auth/change-password'),
  },
  {
    path: 'metrics',
    method: 'GET',
    matchFallback: (url) => url.endsWith('/metrics'),
  },
  {
    path: 'branding',
    method: 'GET',
    // '/branding' can't be a plain suffix: PlatformBrandingController's JWT-protected admin routes
    // (@Controller('platform/tenants/:hospitalId/branding')) also end in '/branding', so a naive
    // .endsWith() match would silently suppress security warnings. TenantBrandingController's
    // public route is a single top-level segment (@Controller('branding')), so matching at most
    // one optional global prefix segment (/api) prevents matching nested admin routes.
    matchFallback: (url) => /^(\/[^/]+)?\/branding$/.test(url),
  },
];

export function isExpectedUnauthenticatedFallback(originalUrl: string): boolean {
  const urlWithoutQuery = originalUrl.split('?')[0];
  return UNAUTHENTICATED_ROUTES.some((route) => route.matchFallback(urlWithoutQuery));
}
