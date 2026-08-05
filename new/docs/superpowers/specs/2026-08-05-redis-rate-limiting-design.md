# Redis Integration: Rate Limiting — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 5 item 11 (`new-features.md` #11)
**Scope:** Redis container/config + rate limiting only. Permission cache and master-data
read-through cache — the other two `new-features.md` #11 asks — are explicitly deferred (see
Non-goals).

## Problem

`new-features.md` #11 lists four things under "Redis integration": a Redis container/config,
rate limiting, a permission cache with invalidation, and an optional master-data read-through
cache. None exist today — no Redis service in `docker-compose.dev.yml`, no rate-limiting
dependency, no permission cache.

Investigating the permission-cache ask surfaced a real doc/code mismatch: `PRD.md` §6.2 says
"role/permission changes invalidate a user's short-TTL Redis cache of permissions ... mirroring
the old `DanpheCache` pattern." The actual implementation (`auth.service.ts`) embeds the
`permissions[]` array directly in the access JWT at login/refresh time — there is no Redis
involved, and no per-request cache lookup at all (`PermissionGuard` just reads
`request.authContext.permissions`, already decoded from the JWT). The access token's own 15-minute
TTL (`ACCESS_TOKEN_TTL`) already bounds how stale a user's permissions can be after a role change —
functionally equivalent to a "short-TTL cache" in effect, just without Redis. Building a literal
Redis-backed permission cache now would mean replacing this already-working, simpler mechanism
with a more complex one for no material gain — deferred, with `PRD.md` corrected to describe
reality instead (see Decisions).

## Decisions

- **New `redis` service in `docker-compose.dev.yml`**: `redis:7-alpine`, host port `6380` (not the
  Redis default `6379`) — matches the same non-default-host-port pattern Postgres already uses
  (`5433`, not `5432`) specifically to avoid colliding with a locally-installed Redis on a dev
  machine.
- **`@nestjs/throttler` + `@nest-lab/throttler-storage-redis`** (using `ioredis` as the Redis
  client) over `@nestjs/throttler`'s default in-memory store. `PRD.md` explicitly lists Redis for
  rate limiting, and an in-memory store would also break correctness the moment the app scales to
  multiple Compose replicas (`Deployment-Guide.md` §7) — each replica would track its own counter,
  letting a client get N× the intended limit by hitting N different replicas.
- **New `apps/api/src/app/redis-client.ts`** exporting `createRedisClient(): Redis` (an `ioredis`
  factory), reading `REDIS_HOST` (default `localhost`) / `REDIS_PORT` (default `6380`) env vars —
  same convention as `DB_HOST`/`DB_PORT`. Lives in `app/` (already `scope:platform`-tagged) rather
  than a new folder, so no Nx module-boundary lint config changes are needed.
- **Global default: 100 requests / 60 seconds per IP**, applied everywhere via `ThrottlerGuard`
  registered as a global `APP_GUARD` in `AppModule` — generic noisy-client protection.
- **Stricter override: 5 requests / 60 seconds per IP on `POST /auth/login` and
  `POST /auth/refresh`** via `@Throttle()` on those two `AuthController` methods — these are the
  actual brute-force/credential-stuffing target, not just general traffic.
- **`PRD.md` §6.2 correction**: replace the "short-TTL Redis cache of permissions" sentence with an
  accurate description — permissions are embedded in the access JWT at login/refresh, bounded by
  the existing 15-minute access-token TTL; no Redis cache exists for this.

## Non-goals

- **Permission cache with invalidation.** The existing JWT-embedded-permissions mechanism already
  bounds staleness to the 15-minute access-token TTL — building a Redis-backed cache now would add
  real complexity (cache population, invalidation wiring on every role/permission-mutating
  endpoint) for no material improvement over what already exists. `PRD.md` §6.2 is corrected to
  describe this instead of the undelivered mechanism it previously claimed.
- **Master-data read-through cache.** `new-features.md` #11 calls it out as "if still desired" —
  no stated pain point is driving it, so it's not built here. A future item once a concrete need
  (e.g. a measured latency problem on a specific master-data lookup) exists.
- **Per-account or per-tenant rate limiting** (as opposed to per-IP). `@nestjs/throttler`'s default
  tracker is IP-based; a smarter tracker (e.g. keyed by `authContext.accountId` for authenticated
  routes) is a reasonable future refinement but not required for this pass — IP-based limiting
  already satisfies the stated brute-force/noisy-client goals.
- **Redis for sessions.** `PRD.md`'s cache/session row also lists "session store," but this
  codebase is JWT-based (stateless, no server-side session store) — there is no session concept for
  Redis to back. Not applicable, not built.

## Testing

- No automated tests, per this session's standing fast-mode instruction. Manual verification:
  script enough rapid requests (101) at a normal endpoint to trigger the global 429, and enough
  (6) at `/auth/login` to trigger the stricter override, confirming both limits are live and that
  the stricter one actually overrides the global default rather than stacking with it.
- Existing suite (`nx run-many -t typecheck test`) must stay green — this is additive: a new guard
  registered globally could in principle affect existing integration specs if they fire many rapid
  requests against the same route in a single test run. Check for this specifically if the suite
  fails after this change, rather than assuming it's unrelated.
