# Frontend Shared Libraries — API Client & Auth — Design

**Status:** Approved
**Parent spec:** `2026-07-30-frontend-framework-architecture-design.md` (workspace structure: `staff-console`
and `patient-portal` share common libraries — API client, auth interceptor, design tokens; this spec
covers the first two, design tokens deferred).
**Repo:** `new_hospital/frontend` (Nx workspace, `apps/staff-console`).

## Problem Statement

Every real `staff-console` screen needs to call the API Gateway and needs the caller to be
authenticated with a valid, auto-refreshing JWT. Without a shared layer, each screen/service would
reimplement HTTP base-URL config, error shaping, token storage, token attachment, and 401/refresh
handling — inconsistently, and with security-sensitive logic (token storage, refresh timing)
duplicated instead of centralized and reviewed once.

## Solution

Two Nx libraries, `libs/api-client` and `libs/auth`, providing:

- A single place all screens call the API Gateway through (`libs/api-client`), with consistent base
  URL config and error normalization.
- A single place that owns login/logout/token storage/token refresh/permission checks
  (`libs/auth`), with an `HttpInterceptorFn` that transparently attaches the access token to every
  outgoing request and transparently refreshes on expiry, so screen-level code never handles auth
  mechanics directly.

## User Stories

1. As a staff-console developer building a new screen, I want to inject one API client service, so
   that I don't re-derive the Gateway base URL or error handling per screen.
2. As a staff-console developer, I want outgoing requests to automatically carry a valid access
   token, so that I never write `Authorization` header logic by hand.
3. As a logged-in user whose 15-minute access token has expired mid-session, I want my next action
   to succeed transparently (silent refresh), so that I'm not interrupted by a login prompt during
   normal use.
4. As a logged-in user whose refresh token has also expired or been rejected, I want to be
   redirected to the login screen with my in-flight action safely abandoned, rather than seeing a
   raw 401 error or stuck request.
5. As a staff-console developer, I want a way to check "does the current user have permission X"
   from route guards or template `*ngIf`s, so that I can hide/disable actions per the PRD's
   permission model without re-parsing the JWT myself.
6. As a staff-console developer, I want failed HTTP calls to arrive in a consistent shape (status,
   message, validation details when present), so that error-display components don't need
   per-endpoint parsing logic.
7. As a user, I want my session to survive a page reload (but not a closed tab/browser restart), so
   that reloading mid-shift doesn't force a fresh login every time.
8. As a security reviewer, I want the access token to never be written to persistent storage, so
   that a successful XSS on this app can't exfiltrate a long-lived credential from disk/localStorage.
9. As a staff-console developer calling the login screen, I want a single `AuthService.login()` call
   that stores tokens and returns success/failure (including the account-locked case the backend
   returns), so that the login component stays purely presentational.
10. As a staff-console developer, I want logout to clear all stored auth state and leave no stale
    token behind, so that a shared/kiosk workstation doesn't leak the next user's session.
11. As a developer of a second app (`patient-portal`, later) reusing `libs/api-client`, I want the
    library to have no `staff-console`-specific assumptions baked in, so that it's genuinely
    reusable — auth specifics (username/password vs. phone/OTP) stay out of `libs/api-client` and
    are `libs/auth`'s concern, not intermixed.

## Implementation Decisions

**`libs/api-client`** (no auth knowledge):

- Wraps Angular's `HttpClient` behind a small injectable service exposing `get`/`post`/`patch`/
  `delete` methods (generic-typed) that prefix requests with the API Gateway base URL, read from
  Angular's environment/config mechanism (not hardcoded) — one build serves every tenant per the
  parent spec's multi-tenancy decision, so this is a single fixed Gateway origin, not
  per-tenant-configurable.
- Normalizes errors: catches `HttpErrorResponse` and re-throws a small `ApiError` shape
  (`status`, `message`, and the raw body when it's the Nest validation-error shape) so downstream
  code doesn't pattern-match on `HttpErrorResponse` directly.
- Has zero dependency on `libs/auth` — the interceptor that attaches tokens is registered at the
  app level (`app.config.ts`'s `provideHttpClient(withInterceptors([...]))`), not inside this
  library, so `libs/api-client` stays usable standalone (e.g. for an unauthenticated login call).

**`libs/auth`** (depends on `libs/api-client` for the login/refresh HTTP calls only):

- `AuthService`: `login(username, password)`, `logout()`, `refresh()` (called internally, not
  normally called by screens), plus reactive state exposed as signals: `isAuthenticated`,
  `currentUser` (decoded `sub`/`roles`/`hospitalId`, from the access token — never trust
  client-decoded claims for authorization decisions server-side, this is for UI display/routing
  only).
  - `login()`'s return type mirrors the backend's three-way result (`accessToken`+`refreshToken` /
    `locked` / `invalidCredentials`) so the login component can show the right message including
    the account-lock case.
- Token storage: **access token held only in an in-memory signal** (never persisted) — lost on
  reload by design, forcing a silent refresh on app bootstrap. **Refresh token stored in
  `sessionStorage`** (survives reload within the same tab, cleared when the tab/browser closes).
  This is a stated security tradeoff, not a full mitigation — `sessionStorage` is still
  JS-readable, so a successful XSS can still steal the refresh token during that tab's lifetime;
  full mitigation (httpOnly cookie-based refresh) is out of scope for this pass since it requires
  backend changes not currently planned (see Out of Scope).
- App bootstrap: an `APP_INITIALIZER`-equivalent (Angular's `provideAppInitializer`) checks
  `sessionStorage` for a refresh token and, if present, calls `refresh()` once before the app
  renders protected routes — so a page reload re-establishes the session transparently instead of
  bouncing to login.
- **`authInterceptor`** (`HttpInterceptorFn`, registered in `app.config.ts`):
  - Attaches `Authorization: Bearer <accessToken>` to every outgoing request, skipping `/auth/login`
    and `/auth/refresh` themselves (those calls predate having a token, or are the refresh call
    itself).
  - On a `401` response: if a refresh is not already in-flight, start one; all requests that 401
    while a refresh is in-flight queue behind that single shared refresh call (via a `Subject`/
    shared observable) rather than each triggering their own refresh — avoids a refresh-token
    race/thundering-herd on simultaneous 401s. Once refresh resolves, retry each queued request
    once with the new access token.
  - If the refresh call itself fails (backend returns `invalidToken`/401): clear all stored auth
    state (in-memory access token + `sessionStorage` refresh token) and navigate to `/login`,
    abandoning the original in-flight request(s) — matches user story 4.
  - A request is retried **at most once** — if the retried request also 401s, treat it as
    `invalidToken` and fall through to the same clear-and-redirect path (guards against infinite
    retry loops if the backend is misbehaving).
- Permission check: `AuthService.hasPermission(permission: string): boolean`, reading the decoded
  access token's `permissions` array (same claim shape the backend's `PermissionGuard` checks
  server-side) — for UI-only gating (hide/disable buttons per the mocks' "permission-aware footer"
  pattern noted in `CLAUDE.md`); the actual authorization enforcement is always server-side, this
  is UX only, never a security boundary.
- `logout()`: clears the in-memory access token, clears the `sessionStorage` refresh token, and
  navigates to `/login`. No server-side call — the backend has no revocation/logout endpoint (per
  its accepted stateless-rotation limitation, see `2026-08-09`'s auth.service.ts comment on refresh
  rotation) so client-side clearing is all that's currently possible.

**JWT decoding**: a minimal manual base64url-decode-the-payload helper (no external JWT library
needed — the claims shape is small, fixed, and controlled by this same codebase's backend), used
only for reading `sub`/`roles`/`hospitalId`/`permissions` for UI display and the `hasPermission`
helper — never used to validate signature/expiry client-side (the interceptor's 401 handling is
the actual expiry-detection mechanism, not client-side `exp` inspection).

## Testing Decisions

- Component/service-level tests independent of `staff-console`, per the parent spec's Testing
  section ("Shared libraries get component-level tests independent of either app").
- `libs/api-client`: test the base-URL prefixing and error-normalization behavior using Angular's
  `HttpClientTestingModule`/`provideHttpClientTesting` + `HttpTestingController` (standard Angular
  pattern, no prior art needed in this greenfield frontend repo).
- `libs/auth`:
  - `AuthService.login`/`refresh`/`logout` behavior against a mocked `api-client`, covering all
    three login result branches (success, locked, invalid credentials) and both refresh outcomes.
  - `authInterceptor`: the highest-value tests here — verify token attachment, verify the
    single-shared-refresh-on-concurrent-401s behavior (multiple simultaneous requests 401'ing
    should trigger exactly one `/auth/refresh` call), verify retry-once-then-give-up, and verify
    the clear-and-redirect path when refresh itself fails. Use `HttpTestingController` to simulate
    401 sequences.
  - `hasPermission`/claim-decoding: pure unit tests against known encoded JWT fixtures.
- Money/PHI/tenant-isolation risk-gating (per this repo's fast-track process) doesn't directly
  apply here (no money/PHI data), but this *is* auth-adjacent infrastructure every future screen
  depends on, so treat interceptor retry/refresh-race tests as mandatory, not optional lighter-weight
  coverage.

## Out of Scope

- `libs/design-tokens` (the third shared library named in the parent spec) — deferred until a
  concrete screen needs shared design-token values beyond what PrimeNG's Aura theme + Tailwind
  already provide.
- `patient-portal` app and its phone/OTP auth flow — `libs/auth`'s `login()` is username/password
  shaped for `staff-console` only; a `patient-portal` OTP flow would need its own service (possibly
  reusing the interceptor and token-storage primitives, but that's a future decision, not designed
  here).
- Refresh-token revocation / logout invalidation on the backend (httpOnly cookie storage, a
  revocation store) — backend limitation, out of scope for a frontend-only spec.
- Route guards themselves (`canActivate` functions gating whole routes on `isAuthenticated`/
  `hasPermission`) — `AuthService` exposes what a guard needs, but wiring actual route guards
  happens per-route as real routes are built, not as part of this shared-library spec.
- Retry/backoff for non-401 network failures (5xx, offline) — only 401-triggered refresh-and-retry
  is in scope; general resilience (exponential backoff, offline queueing) is not.

## Further Notes

`libs/api-client` must not import from `libs/auth` (one-directional dependency, enforced by Nx
module boundaries once configured) — keeps the interceptor registration at the app level rather
than baked into the client, which is what keeps `libs/api-client` reusable by `patient-portal`
later without dragging staff-console-shaped auth assumptions along.
