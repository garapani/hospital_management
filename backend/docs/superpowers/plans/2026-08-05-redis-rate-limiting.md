# Redis Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Redis and add rate limiting — a generous global default plus a strict override
on the two auth endpoints — closing the "Redis container/config" and "rate limiting" asks from
`new-features.md` #11.

**Architecture:** A new `redis` Compose service backs `@nestjs/throttler`'s Redis storage adapter,
registered as a global `APP_GUARD` in `AppModule`. `AuthController`'s `login`/`refresh` get a
stricter per-route override via `@Throttle()`.

**Tech Stack:** `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`, `ioredis`, Redis 7
(Alpine image).

## Global Constraints

- **Scope: Redis container + rate limiting only.** Permission cache and master-data cache are
  explicitly deferred (separate future items) — not part of this plan.
- **Global default: 100 requests / 60 seconds per IP**, everywhere.
- **Stricter override: 5 requests / 60 seconds per IP** on `POST /auth/login` and
  `POST /auth/refresh` specifically.
- **Rate limiting must not fire during the Jest suite.** Multiple integration spec files
  independently hit `/auth/login` via real HTTP requests through a bootstrapped Nest app
  (`auth.controller.integration-spec.ts`, `cross-tenant-login.integration-spec.ts`,
  `app-module-auth-wiring.integration-spec.ts`) — since the Redis-backed throttle counter is a
  real external store shared across every test file's app instance (not reset per file), running
  the full suite could accumulate enough combined `/auth/login` hits across files to trip the
  5/60s limit and cause spurious 429s in tests that don't expect them. Both the global and the
  auth-specific limits raise to `1_000_000` when `NODE_ENV === 'test'` (Jest sets this
  automatically) — effectively disabling throttling in tests without a separate code path.
- **No automated tests.** Per the human partner's standing instruction this session, implement
  directly; verification is manual (see Task 3).

---

### Task 1: Redis service in `docker-compose.dev.yml`

**Files:**
- Modify: `docker-compose.dev.yml`

**Interfaces:**
- Produces: a `redis` container reachable at `localhost:6380` from the host — Task 2's
  `createRedisClient()` connects here by default.

- [ ] **Step 1: Add the service**

`docker-compose.dev.yml` currently reads:
```yaml
services:
  api-postgres:
    image: postgres:16-alpine
    container_name: api-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - api-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  api-postgres-data:
```
Replace with:
```yaml
services:
  api-postgres:
    image: postgres:16-alpine
    container_name: api-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - api-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

  api-redis:
    image: redis:7-alpine
    container_name: api-redis-dev
    ports:
      - '6380:6379'
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  api-postgres-data:
```
Host port `6380` (not Redis's default `6379`) matches the same non-default-port pattern Postgres
already uses (`5433`, not `5432`) to avoid colliding with a locally-installed Redis. No volume —
losing rate-limit counters on restart is fine, unlike Postgres data.

- [ ] **Step 2: Verify**

```bash
docker-compose -f docker-compose.dev.yml up -d
docker exec api-redis-dev redis-cli ping
```
Expected: `PONG`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat(ops): add Redis service to local dev compose stack"
```

---

### Task 2: Install dependencies + `redis-client.ts`

**Files:**
- Create: `apps/api/src/app/redis-client.ts`

**Interfaces:**
- Produces: `createRedisClient(): Redis` (an `ioredis` instance factory) — Task 3's
  `ThrottlerModule` wiring consumes this.

- [ ] **Step 1: Install dependencies**

From `new/code`:
```bash
pnpm add -w @nestjs/throttler @nest-lab/throttler-storage-redis ioredis
```

- [ ] **Step 2: Write the Redis client factory**

`apps/api/src/app/redis-client.ts`:
```ts
import Redis from 'ioredis';

export function createRedisClient(): Redis {
  return new Redis({
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: Number(process.env['REDIS_PORT'] ?? 6380),
  });
}
```

- [ ] **Step 3: Confirm `@nest-lab/throttler-storage-redis`'s actual API before Task 3**

This package has never been used in this codebase — before writing Task 3's wiring, check its
installed type definitions to confirm the exact constructor/class shape:
```bash
find new/code/node_modules/.pnpm -maxdepth 1 -iname '@nest-lab+throttler-storage-redis@*'
cat new/code/node_modules/@nest-lab/throttler-storage-redis/dist/*.d.ts
```
Task 3 assumes it exports a `ThrottlerStorageRedisService` class implementing `@nestjs/throttler`'s
`ThrottlerStorage` interface, constructed as `new ThrottlerStorageRedisService(redisClient)` (an
`ioredis` instance). If the installed package's actual shape differs, adjust Task 3's
`ThrottlerModule.forRootAsync` factory to match whatever the real constructor/export looks like —
don't force the assumed shape onto a different real API.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app/redis-client.ts package.json pnpm-lock.yaml
git commit -m "feat(ops): add ioredis client factory and throttler dependencies"
```

---

### Task 3: Wire `ThrottlerModule` + stricter auth limits + manual verification

**Files:**
- Modify: `apps/api/src/app/app.module.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`

**Interfaces:**
- Consumes: `createRedisClient()` from Task 2, and whatever `@nest-lab/throttler-storage-redis`
  export Task 2 Step 3 confirmed.

- [ ] **Step 1: Wire `ThrottlerModule` into `AppModule`**

`apps/api/src/app/app.module.ts` currently reads:
```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ObservabilityLoggerModule } from '@hospital/observability';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VitalsModule } from '../clinical/vitals/vitals.module.js';
import { EncountersModule } from '../clinical/encounters/encounters.module.js';
import { TriageModule } from '../clinical/triage/triage.module.js';
import { AdmissionsModule } from '../admissions/admissions.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';

@Module({
  imports: [ObservabilityLoggerModule, TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthContextMiddleware)
      .exclude(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/refresh', method: RequestMethod.POST },
      )
      .forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```
Replace with (adjust the `ThrottlerStorageRedisService` import/usage here if Task 2 Step 3 found a
different real API shape):
```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ObservabilityLoggerModule } from '@hospital/observability';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MasterDataModule } from '../master-data/master-data.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { AppointmentsModule } from '../appointments/appointments.module.js';
import { VitalsModule } from '../clinical/vitals/vitals.module.js';
import { EncountersModule } from '../clinical/encounters/encounters.module.js';
import { TriageModule } from '../clinical/triage/triage.module.js';
import { AdmissionsModule } from '../admissions/admissions.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { ReportingModule } from '../reporting/reporting.module.js';
import { createRedisClient } from './redis-client.js';

const GLOBAL_RATE_LIMIT = process.env['NODE_ENV'] === 'test' ? 1_000_000 : 100;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ ttl: 60_000, limit: GLOBAL_RATE_LIMIT }],
        storage: new ThrottlerStorageRedisService(createRedisClient()),
      }),
    }),
    ObservabilityLoggerModule,
    TenantContextModule,
    AuthModule,
    TenantsModule,
    AuditModule,
    MasterDataModule,
    PatientsModule,
    AppointmentsModule,
    VitalsModule,
    EncountersModule,
    TriageModule,
    AdmissionsModule,
    OrdersModule,
    BillingModule,
    ReportingModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthContextMiddleware)
      .exclude(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/refresh', method: RequestMethod.POST },
      )
      .forRoutes('*');
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 2: Add the stricter auth override**

`apps/api/src/auth/auth.controller.ts` currently reads:
```ts
import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body);

    if ('accessToken' in result) {
      return result;
    }

    if ('locked' in result) {
      res.status(HttpStatus.LOCKED);
      return { message: 'Account locked', retryAfterSeconds: result.retryAfterSeconds };
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid username or password' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: RefreshTokenDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(body);

    if ('accessToken' in result) {
      return result;
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid or expired refresh token' };
  }
}
```
Replace with:
```ts
import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';

const AUTH_RATE_LIMIT = process.env['NODE_ENV'] === 'test' ? 1_000_000 : 5;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(body);

    if ('accessToken' in result) {
      return result;
    }

    if ('locked' in result) {
      res.status(HttpStatus.LOCKED);
      return { message: 'Account locked', retryAfterSeconds: result.retryAfterSeconds };
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid username or password' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: 60_000 } })
  async refresh(@Body() body: RefreshTokenDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refresh(body);

    if ('accessToken' in result) {
      return result;
    }

    res.status(HttpStatus.UNAUTHORIZED);
    return { message: 'Invalid or expired refresh token' };
  }
}
```

- [ ] **Step 3: Typecheck and run the existing suite**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`)
Expected: all projects typecheck clean, full existing suite stays green. If any test fails with a
429/`ThrottlerException`, that means the `NODE_ENV === 'test'` bypass isn't actually taking effect
(e.g. Jest's env var isn't visible at the point `GLOBAL_RATE_LIMIT`/`AUTH_RATE_LIMIT` are
evaluated) — investigate and fix the bypass condition rather than raising the limit further, since
a flaky-under-load limit is the actual bug the Global Constraints section called out.

- [ ] **Step 4: Manual verification**

Start local Postgres, Redis, and the API:
```bash
docker-compose -f docker-compose.dev.yml up -d
pnpm exec nx serve api
```

Confirm the stricter auth limit first (cheaper to test — only needs 6 requests):
```bash
for i in $(seq 1 6); do
  curl -s -o /dev/null -w "attempt $i: status=%{http_code}\n" -X POST \
    -H "Content-Type: application/json" \
    -d '{"username":"nonexistent","password":"wrong"}' \
    http://localhost:3000/api/auth/login
done
```
Expected: attempts 1-5 return `401` (invalid credentials — the login logic itself runs, it's just
wrong credentials), attempt 6 returns `429`.

Then confirm the global default limit on an unrelated route (needs 101 requests — this one takes a
few seconds):
```bash
for i in $(seq 1 101); do
  status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/patients)
  if [ "$i" -eq 101 ]; then
    echo "request $i: status=$status"
  fi
done
```
Expected: request 101 returns `429` (requests 1-100 return `401`, since this route requires auth
and no token was sent — the point is confirming the 101st request is rate-limited, not that the
route itself succeeds).

Stop the server (`Ctrl+C`) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app/app.module.ts apps/api/src/auth/auth.controller.ts
git commit -m "feat(security): add Redis-backed rate limiting with stricter auth-endpoint limits"
```

---

### Task 4: Documentation

**Files:**
- Modify: `new/docs/technical-design/PRD.md`
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Fix `PRD.md` §6.2's permission-cache claim**

The line currently reads:
```markdown
- **Cache invalidation:** role/permission changes invalidate a user's short-TTL Redis cache of permissions (mirroring the old `DanpheCache` pattern in `RBAC.cs`) via a direct in-process call — no event bus needed now that the module making the change and the modules reading the cache share one process.
```
Replace with:
```markdown
- **Permission propagation:** permissions are embedded directly in the access JWT at login/refresh time (not cached in Redis, despite an earlier version of this document describing a `DanpheCache`-style Redis cache) — a role/permission change takes effect the next time a user's access token is refreshed, bounded by the 15-minute access-token TTL. This is functionally equivalent to a short-TTL cache without the added complexity of a separate cache-invalidation path; revisit only if 15 minutes of staleness becomes a real operational problem.
```

- [ ] **Step 2: Add a Development-Standards.md section**

Append after the existing `## 11. Reporting Dashboard Reads` section, which currently ends the
file with:
```markdown
See `new/docs/superpowers/plans/2026-08-05-reporting-dashboard-read-apis.md` for the full
implementation history.
```
Add:
```markdown

## 12. Rate Limiting

`@nestjs/throttler` is registered globally via `APP_GUARD` in `AppModule`, backed by
`@nest-lab/throttler-storage-redis` (an `ioredis` client from `apps/api/src/app/redis-client.ts`,
`REDIS_HOST`/`REDIS_PORT` env vars, default `localhost`/`6380`) rather than the package's default
in-memory store — an in-memory store would let a client get N× the intended limit by hitting N
different Compose replicas once the app scales out (`Deployment-Guide.md` §7).

**Limits:** global default 100 requests/60s per IP everywhere; `POST /auth/login` and
`POST /auth/refresh` override to a stricter 5 requests/60s via `@Throttle()`, since those are the
actual brute-force/credential-stuffing target, not just general traffic.

**Test bypass:** both limits raise to `1_000_000` when `NODE_ENV === 'test'` (Jest sets this
automatically). This isn't defensive — several integration spec files independently make real HTTP
requests to `/auth/login` through a bootstrapped Nest app, and since the Redis-backed counter is a
real external store shared across every test file (not reset per file), the combined hits across
the full suite could otherwise trip the 5/60s limit and cause spurious 429s in unrelated tests.

**Corrected:** `PRD.md` §6.2 previously described permissions as living in a "short-TTL Redis cache
of permissions" — not true; permissions are JWT-embedded with a 15-minute TTL, already bounding
staleness without Redis. See that section for the corrected description. A literal Redis
permission cache and a master-data read-through cache (the other two `new-features.md` #11 asks)
remain undelivered — no driving need for either yet.

See `new/docs/superpowers/plans/2026-08-05-redis-rate-limiting.md` for the full implementation
history.
```

- [ ] **Step 3: Check off `pending-tasks.md` Phase 5 item 11**

The line currently reads:
```markdown
11. **Redis integration** (new-features.md #11) — pairs naturally with item 3's permission-check
    rework; do it while that code is already open.
```
Replace with:
```markdown
11. [x] **Redis integration** (new-features.md #11) — **Redis container + rate limiting only**,
    done: `docker-compose.dev.yml`'s `api-redis` service, `@nestjs/throttler` with a Redis-backed
    storage adapter, global 100/60s default plus a stricter 5/60s override on
    `POST /auth/login`/`POST /auth/refresh`. **Not done:** permission cache (deferred — the
    existing JWT-embedded-permissions mechanism already bounds staleness to 15 minutes without
    Redis; `PRD.md` §6.2 corrected to describe this instead) and master-data read-through cache
    (deferred, no driving need yet).
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/PRD.md new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: correct PRD permission-cache claim, document rate limiting, check off Phase 5 item 11"
```
