# JWT-Backed Request Authentication — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 1 item 2 (`new-features.md` #1)

## Problem

`AuthService.login()` already signs real JWTs (`@nestjs/jwt` is an existing dependency) carrying
`sub`, `roles`, `permissions`, `hospitalId` — but nothing ever verifies them. Every subsequent
request is authorized entirely from client-controlled headers:

- `TenantContextMiddleware` (`libs/tenant-context/src/lib/tenant-context.middleware.ts`) reads
  `x-tenant-id`/`x-account-id` directly.
- `RequestContextFactory` (`libs/auth-guards/src/lib/request-context.ts`) reads
  `x-roles`/`x-permissions`/`x-patient-id` directly.
- `PermissionGuard` (`libs/auth-guards/src/lib/permission.guard.ts`) reads `x-permissions` directly.

Any caller can set these headers to impersonate any tenant, account, role, or permission. There is
no `passport-jwt`/`JwtStrategy`/`JwtAuthGuard` anywhere in the codebase, and no `/auth/refresh`
endpoint consumes the refresh token `login()` already issues.

## Decisions

- **Verification point: middleware, not a Guard.** A new `AuthContextMiddleware`
  (`libs/auth-guards`) runs *before* `TenantContextMiddleware` in the Express pipeline. It verifies
  `Authorization: Bearer <token>` via `JwtService.verifyAsync()` and attaches the verified payload
  to `req.authContext: RequestContext` (reusing the existing `RequestContext` shape). Chosen over a
  Guard-based (`passport-jwt`) approach because tenant context must be seeded into
  `TenantContextService`'s `AsyncLocalStorage` before most service-layer code runs, and Express
  middleware runs ahead of Nest's guard pipeline — a Guard-only approach would verify too late for
  that seeding to happen cleanly.
- **Single verification, shared result.** `TenantContextMiddleware` reads `tenantId`/`accountId`
  from `req.authContext` instead of headers. `RequestContextFactory.fromRequest()` reads
  `roles`/`permissions`/`patientId` from the same `req.authContext` instead of headers.
  `PermissionGuard` reads permissions from `req.authContext`. One verification per request, one
  source of truth — no independent re-verification anywhere downstream.
- **`JwtModule` becomes global** (`JwtModule.register({ ..., global: true })` in `AuthModule`), so
  `JwtService` is injectable into `AuthContextMiddleware` (a different lib) without a circular
  import between `@hospital/auth-guards` and the app's `AuthModule`.
- **Public routes:** `POST /auth/login` and `POST /auth/refresh` are excluded from
  `AuthContextMiddleware` via `MiddlewareConsumer.exclude(...)` — the idiomatic Nest mechanism for
  this, not a hardcoded path check inside the middleware.
- **`POST /auth/refresh`:** verifies the refresh token, checks a `type: 'refresh'` claim (added to
  the refresh payload; the access-token payload gets `type: 'access'`) so a leaked access token
  can't be replayed as a refresh token. Re-fetches the account's *current* roles/permissions from
  `AccountsService` rather than trusting stale values — a role/permission revoked since login takes
  effect on the next refresh instead of persisting until the 15-minute access token naturally
  expires. Rotates the refresh token on each use (issues a new one instead of reusing the old) —
  **note this is a stateless rotation only**: there is no revocation store in this codebase, so the
  previous refresh token remains cryptographically valid until its own 7-day expiry rather than
  being immediately invalidated. Closing that gap would need a persisted issued/used-token table,
  which is separate, unscoped work.
- **`JWT_SECRET`:** fails fast (throws at module init) when `NODE_ENV === 'production'` and the env
  var is unset. Keeps the existing dev-only fallback otherwise, matching this codebase's established
  `DB_USERNAME`/`DB_HOST`-style convention (dev fallback, real value required in production).
- **Tests mint real JWTs.** No permanent test-only header bypass. A new shared helper,
  `apps/api/src/testing/test-jwt.ts` (`signTestToken(jwtService, claims)`), lets specs sign a real
  token with whatever `sub`/`hospitalId`/`roles`/`permissions` the test needs, resolving `JwtService`
  from the spec's already-booted `moduleFixture` (guarantees the same secret the app under test
  uses). Every controller-style spec currently setting `x-tenant-id`/`x-permissions` headers (or
  overriding `PermissionGuard` to fake `req.user`) is migrated to send
  `Authorization: Bearer <token>` instead — this is not optional cleanup, those tests fail the
  moment real verification ships.

## Scope

**In scope:**
- `AuthContextMiddleware` (new, `libs/auth-guards`)
- `TenantContextMiddleware`, `RequestContextFactory`, `PermissionGuard` updated to read
  `req.authContext` instead of headers
- `AuthModule`: `JwtModule` becomes global; `JWT_SECRET` fail-fast in production
- `POST /auth/refresh` endpoint, `type` claim on both token kinds, refresh-token rotation,
  fresh roles/permissions lookup on refresh
- `apps/api/src/testing/test-jwt.ts` helper
- Migration of ~14-15 controller-style integration specs (accounts, admissions, appointments, auth,
  billing×3, encounters, triage, vitals, master-data, orders, patients, tenants) onto real JWTs,
  batched the same way as the `TenantTestContext` migration

**Out of scope:**
- `patientId` claim handling — no patient-facing login flow exists yet to produce one; the current
  `login()` payload has no `patientId`, and adding a patient-portal auth flow is separate,
  unscoped work.
- Nx module-boundary lint, DB-enforced tenant isolation, and every other `pending-tasks.md` item —
  separate phases.
- Rate limiting / brute-force protection beyond the existing account-lockout mechanism (unrelated to
  the header-trust gap this task closes).

## Out of scope, noted for the record

`RequestContext`'s `patientId` field stays unused by this task (no producer exists yet) — not
removed, since a future patient-portal auth flow will populate it the same way.
