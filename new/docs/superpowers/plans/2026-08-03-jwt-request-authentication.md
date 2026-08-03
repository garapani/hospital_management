# JWT-Backed Request Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace client-controlled-header trust (`x-tenant-id`, `x-account-id`, `x-permissions`, `x-roles`, `x-patient-id`) with real JWT verification on every request except login/refresh, close the missing `/auth/refresh` endpoint, and migrate every affected integration spec onto real signed tokens.

**Architecture:** A new `AuthContextMiddleware` (in `@hospital/auth-guards`) runs ahead of `TenantContextMiddleware`, verifies `Authorization: Bearer <token>` via `JwtService`, and attaches the verified identity to `req.authContext`. `TenantContextMiddleware`, `RequestContextFactory`, and `PermissionGuard` all read from `req.authContext` instead of headers. Full design rationale: `new/docs/superpowers/specs/2026-08-03-jwt-request-authentication-design.md`.

**Tech Stack:** NestJS, `@nestjs/jwt` (already a dependency), TypeScript, Jest. Nx workspace root: `new/code/`. All paths below are relative to `new/code/`.

## Global Constraints

- `JWT_SECRET` resolution lives in exactly one place (`apps/api/src/auth/jwt-secret.ts`), used by both `AuthModule` and the test-JWT helper — never duplicate the fallback string literal.
- Every signed token (access or refresh) carries a `type: 'access' | 'refresh'` claim. `AuthContextMiddleware` and `AuthService.refresh()` both reject a token whose `type` doesn't match what's expected at that call site.
- **Login is the one legitimate exception to "never trust headers for identity."** `POST /auth/login` and `POST /auth/refresh` are excluded from `AuthContextMiddleware` (no prior JWT exists yet at login; refresh derives its own tenant from the refresh token's own `hospitalId` claim, not from any header). `TenantContextMiddleware` therefore falls back to `x-tenant-id`/`x-account-id` headers **only** when `req.authContext` is absent (i.e. only ever on those two excluded routes) — every other route always has `req.authContext` populated by `AuthContextMiddleware` and never falls back to headers. Document this asymmetry with a code comment, not just this doc.
- `AuthService.refresh()` must not depend on any ambient tenant context seeded from a header — it explicitly wraps its `AccountsService` call in `this.tenantContext.run({ tenantId: <hospitalId from the verified refresh token> , ... }, ...)`, so refresh is self-sufficient from the refresh token alone.
- No permanent test-only auth bypass. Tests mint real tokens via the shared `signTestToken()` helper (Task 6).
- Migration must be behavior-preserving for every migrated spec: same test names, same test counts, same assertions — only how identity reaches the request changes (`.set(headers)` → `.set('Authorization', 'Bearer <token>')`, plus wiring `AuthContextMiddleware` into each file's manually-constructed test app ahead of `TenantContextMiddleware`).
- `.js` extensions on every relative import (ESM + `nodenext`). Run `pnpm exec nx run-many -t typecheck test` before considering any task done, not just `test`.
- Never `git commit --amend`. No AI co-authorship trailer.

---

### Task 1: JWT secret resolver + global `JwtModule` + fail-fast

**Files:**
- Create: `apps/api/src/auth/jwt-secret.ts`
- Create: `apps/api/src/auth/jwt-secret.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

**Interfaces:**
- Produces: `function resolveJwtSecret(): string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/jwt-secret.spec.ts`:

```ts
import { resolveJwtSecret } from './jwt-secret.js';

describe('resolveJwtSecret', () => {
  const originalSecret = process.env['JWT_SECRET'];
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env['JWT_SECRET'];
    } else {
      process.env['JWT_SECRET'] = originalSecret;
    }
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('returns JWT_SECRET when set', () => {
    process.env['JWT_SECRET'] = 'a-real-secret';
    expect(resolveJwtSecret()).toBe('a-real-secret');
  });

  it('falls back to the dev-only default when unset and not in production', () => {
    delete process.env['JWT_SECRET'];
    process.env['NODE_ENV'] = 'test';
    expect(resolveJwtSecret()).toBe('dev-only-insecure-secret-change-in-production');
  });

  it('throws when unset and NODE_ENV is production', () => {
    delete process.env['JWT_SECRET'];
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveJwtSecret()).toThrow('JWT_SECRET must be set in production');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api jwt-secret.spec`
Expected: FAIL — `Cannot find module './jwt-secret.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/auth/jwt-secret.ts`:

```ts
const DEV_ONLY_DEFAULT_SECRET = 'dev-only-insecure-secret-change-in-production';

export function resolveJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (secret) {
    return secret;
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return DEV_ONLY_DEFAULT_SECRET;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api jwt-secret.spec`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Wire into `AuthModule` — make `JwtModule` global**

Modify `apps/api/src/auth/auth.module.ts`. Current content:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextModule } from '@hospital/tenant-context';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [
    TenantContextModule,
    AccountsModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-insecure-secret-change-in-production',
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

Replace the `JwtModule.register(...)` block and add the import:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextModule } from '@hospital/tenant-context';
import { AccountsModule } from '../accounts/accounts.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { resolveJwtSecret } from './jwt-secret.js';

@Module({
  imports: [
    TenantContextModule,
    AccountsModule,
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 6: Run full suite to confirm no regression**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS, same total as before this task (this task only adds one new file pair and swaps an inline literal for a function call — no behavior change for any existing test, since `NODE_ENV` is `test` in the whole suite and the fallback value is unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth/jwt-secret.ts apps/api/src/auth/jwt-secret.spec.ts apps/api/src/auth/auth.module.ts
git commit -m "feat(auth): add JWT secret resolver with production fail-fast, make JwtModule global"
```

---

### Task 2: `AuthContextMiddleware`

**Files:**
- Create: `libs/auth-guards/src/lib/auth-context.middleware.ts`
- Create: `libs/auth-guards/src/lib/auth-context.middleware.spec.ts`
- Modify: `libs/auth-guards/src/lib/request-context.ts` (add the `Request.authContext` type augmentation)
- Modify: `libs/auth-guards/src/index.ts`

**Interfaces:**
- Consumes: `RequestContext` (from `request-context.ts`)
- Produces: `AuthContextMiddleware`, and the ambient `Request.authContext?: RequestContext` field every later task reads

- [ ] **Step 1: Add the `Request.authContext` type augmentation**

Modify `libs/auth-guards/src/lib/request-context.ts`. Current content:

```ts
import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  accountId?: string;
  hospitalId?: string;
  roles: string[];
  permissions: string[];
  patientId?: string;
}

function parseCsvHeader(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

@Injectable()
export class RequestContextFactory {
  fromRequest(req: Request): RequestContext {
    return {
      accountId: req.header('x-account-id') || undefined,
      hospitalId: req.header('x-tenant-id') || undefined,
      roles: parseCsvHeader(req.header('x-roles')),
      permissions: parseCsvHeader(req.header('x-permissions')),
      patientId: req.header('x-patient-id') || undefined,
    };
  }
}
```

Replace it with (this also implements the RequestContextFactory rewrite from Task 3 early since the two changes touch the same file — but ONLY the type augmentation is done in this step; leave `fromRequest`'s body untouched here, do the body swap in Task 3):

```ts
import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface RequestContext {
  accountId?: string;
  hospitalId?: string;
  roles: string[];
  permissions: string[];
  patientId?: string;
}

declare module 'express' {
  interface Request {
    authContext?: RequestContext;
  }
}

function parseCsvHeader(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

@Injectable()
export class RequestContextFactory {
  fromRequest(req: Request): RequestContext {
    return {
      accountId: req.header('x-account-id') || undefined,
      hospitalId: req.header('x-tenant-id') || undefined,
      roles: parseCsvHeader(req.header('x-roles')),
      permissions: parseCsvHeader(req.header('x-permissions')),
      patientId: req.header('x-patient-id') || undefined,
    };
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `libs/auth-guards/src/lib/auth-context.middleware.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthContextMiddleware } from './auth-context.middleware.js';

describe('AuthContextMiddleware', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });

  function buildRequest(authorizationHeader: string | undefined) {
    return { header: (name: string) => (name === 'authorization' ? authorizationHeader : undefined) } as any;
  }

  it('attaches req.authContext from a valid access token', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: ['Doctor'], permissions: ['clinical.notes.write'], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let nextCalled = false;

    await middleware.use(req, {} as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.authContext).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
    });
  });

  it('calls next with UnauthorizedException when the Authorization header is missing', async () => {
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(undefined);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the header is not a Bearer token', async () => {
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest('Basic somevalue');
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token signature is invalid', async () => {
    const otherService = new JwtService({ secret: 'a-different-secret' });
    const token = await otherService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
      { expiresIn: '15m' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token is expired', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', roles: [], permissions: [], type: 'access' },
      { expiresIn: '-1s' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });

  it('calls next with UnauthorizedException when the token type is refresh, not access', async () => {
    const token = await jwtService.signAsync(
      { sub: 'acc-1', hospitalId: 'h1', type: 'refresh' },
      { expiresIn: '7d' },
    );
    const middleware = new AuthContextMiddleware(jwtService);
    const req = buildRequest(`Bearer ${token}`);
    let capturedError: unknown;

    await middleware.use(req, {} as any, (err?: unknown) => {
      capturedError = err;
    });

    expect(capturedError).toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec jest -c libs/auth-guards/jest.config.cts --rootDir libs/auth-guards auth-context.middleware.spec`
Expected: FAIL — `Cannot find module './auth-context.middleware.js'`

- [ ] **Step 4: Write the implementation**

Create `libs/auth-guards/src/lib/auth-context.middleware.ts`:

```ts
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { RequestContext } from './request-context.js';

interface AccessTokenPayload {
  sub: string;
  hospitalId: string;
  roles: string[];
  permissions: string[];
  type: string;
}

@Injectable()
export class AuthContextMiddleware implements NestMiddleware {
  constructor(private readonly jwtService: JwtService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.header('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      next(new UnauthorizedException('Missing or malformed Authorization header'));
      return;
    }

    const token = authHeader.slice('Bearer '.length);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      next(new UnauthorizedException('Invalid or expired token'));
      return;
    }

    if (payload.type !== 'access') {
      next(new UnauthorizedException('Token is not an access token'));
      return;
    }

    const authContext: RequestContext = {
      accountId: payload.sub,
      hospitalId: payload.hospitalId,
      roles: payload.roles,
      permissions: payload.permissions,
    };

    req.authContext = authContext;
    next();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run the same command from Step 3.
Expected: PASS, all 6 tests green.

- [ ] **Step 6: Export from the library barrel**

Modify `libs/auth-guards/src/index.ts`. Current content:

```ts
export * from './lib/require-permission.decorator.js';
export * from './lib/permission.guard.js';
export * from './lib/request-context.js';
```

Add the new export:

```ts
export * from './lib/require-permission.decorator.js';
export * from './lib/permission.guard.js';
export * from './lib/request-context.js';
export * from './lib/auth-context.middleware.js';
```

- [ ] **Step 7: Run full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS, same total as before this task plus these 6 new tests.

- [ ] **Step 8: Commit**

```bash
git add libs/auth-guards/src/lib/auth-context.middleware.ts libs/auth-guards/src/lib/auth-context.middleware.spec.ts libs/auth-guards/src/lib/request-context.ts libs/auth-guards/src/index.ts
git commit -m "feat(auth-guards): add AuthContextMiddleware for JWT verification"
```

---

### Task 3: Update `TenantContextMiddleware`, `RequestContextFactory`, `PermissionGuard` to read `req.authContext`

**Files:**
- Modify: `libs/tenant-context/src/lib/tenant-context.middleware.ts`
- Modify: `libs/tenant-context/src/lib/tenant-context.middleware.spec.ts`
- Modify: `libs/auth-guards/src/lib/request-context.ts`
- Modify: `libs/auth-guards/src/lib/request-context.spec.ts`
- Modify: `libs/auth-guards/src/lib/permission.guard.ts`
- Modify: `libs/auth-guards/src/lib/permission.guard.spec.ts`

**Interfaces:**
- Consumes: `Request.authContext` (Task 2)

- [ ] **Step 1: Update `TenantContextMiddleware` — header fallback only when `authContext` is absent**

Modify `libs/tenant-context/src/lib/tenant-context.middleware.ts`. Current content:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const tenantId = req.header('x-tenant-id') || undefined;
    const accountId = req.header('x-account-id') || undefined;
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () =>
      next(),
    );
  }
}
```

Replace with:

```ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from './tenant-context.service.js';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // req.authContext is set by AuthContextMiddleware, which runs first on every route except
    // POST /auth/login and POST /auth/refresh (excluded — no prior JWT can exist at login, and
    // refresh derives its own tenant from the refresh token's own claim). Falling back to headers
    // here is ONLY ever reached on those two excluded routes, never on an authenticated one.
    const tenantId = req.authContext?.hospitalId ?? (req.header('x-tenant-id') || undefined);
    const accountId = req.authContext?.accountId ?? (req.header('x-account-id') || undefined);
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () =>
      next(),
    );
  }
}
```

- [ ] **Step 2: Update `TenantContextMiddleware`'s test**

Modify `libs/tenant-context/src/lib/tenant-context.middleware.spec.ts`. Current content is the 3-test file shown in this task's context (propagates from headers; generates new correlation id; calls next() when headers absent). Replace the first test and add two new ones so the file covers both the `authContext`-present and `authContext`-absent (header-fallback) paths:

```ts
import { TenantContextMiddleware } from './tenant-context.middleware.js';
import { TenantContextService } from './tenant-context.service.js';

describe('TenantContextMiddleware', () => {
  function buildRequest(
    headers: Record<string, string | undefined>,
    authContext?: { hospitalId?: string; accountId?: string },
  ) {
    return { header: (name: string) => headers[name], authContext } as any;
  }

  it('propagates tenant id and account id from req.authContext when present, ignoring headers', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest(
      { 'x-tenant-id': 'header-tenant', 'x-account-id': 'header-account', 'x-correlation-id': 'corr-1' },
      { hospitalId: 'h1', accountId: 'acc-1' },
    );

    let observed: unknown;
    middleware.use(req, {} as any, () => {
      observed = {
        tenantId: service.getTenantId(),
        accountId: service.getAccountId(),
        correlationId: service.getCorrelationId(),
      };
    });

    expect(observed).toEqual({
      tenantId: 'h1',
      accountId: 'acc-1',
      correlationId: 'corr-1',
    });
  });

  it('falls back to headers when req.authContext is absent (login/refresh routes only)', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({
      'x-tenant-id': 'h1',
      'x-account-id': 'acc-1',
      'x-correlation-id': 'corr-1',
    });

    let observed: unknown;
    middleware.use(req, {} as any, () => {
      observed = {
        tenantId: service.getTenantId(),
        accountId: service.getAccountId(),
        correlationId: service.getCorrelationId(),
      };
    });

    expect(observed).toEqual({
      tenantId: 'h1',
      accountId: 'acc-1',
      correlationId: 'corr-1',
    });
  });

  it('generates a new correlation id when none is provided', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({});

    let observedCorrelationId: string | undefined;
    middleware.use(req, {} as any, () => {
      observedCorrelationId = service.getCorrelationId();
    });

    expect(observedCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('calls next() even when tenant id and account id are absent from both authContext and headers', () => {
    const service = new TenantContextService();
    const middleware = new TenantContextMiddleware(service);
    const req = buildRequest({});
    let nextCalled = false;

    middleware.use(req, {} as any, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
```

- [ ] **Step 3: Run `tenant-context` tests to confirm this file passes in isolation**

Run: `pnpm exec jest -c libs/tenant-context/jest.config.cts --rootDir libs/tenant-context`
Expected: PASS, 4 tests green.

- [ ] **Step 4: Update `RequestContextFactory.fromRequest()`**

Modify `libs/auth-guards/src/lib/request-context.ts` (the file already has the type augmentation from Task 2 — only the `fromRequest` method body changes now). Replace:

```ts
  fromRequest(req: Request): RequestContext {
    return {
      accountId: req.header('x-account-id') || undefined,
      hospitalId: req.header('x-tenant-id') || undefined,
      roles: parseCsvHeader(req.header('x-roles')),
      permissions: parseCsvHeader(req.header('x-permissions')),
      patientId: req.header('x-patient-id') || undefined,
    };
  }
```

with:

```ts
  fromRequest(req: Request): RequestContext {
    if (req.authContext) {
      return req.authContext;
    }
    // Only reachable on POST /auth/login and POST /auth/refresh, which never populate
    // req.authContext (see AuthContextMiddleware / TenantContextMiddleware).
    return {
      accountId: req.header('x-account-id') || undefined,
      hospitalId: req.header('x-tenant-id') || undefined,
      roles: parseCsvHeader(req.header('x-roles')),
      permissions: parseCsvHeader(req.header('x-permissions')),
      patientId: req.header('x-patient-id') || undefined,
    };
  }
```

- [ ] **Step 5: Update `request-context.spec.ts`**

Modify `libs/auth-guards/src/lib/request-context.spec.ts`. Current content builds a fake `req` with only `.header(...)`. Add a new first test for the `authContext`-present path, keep the existing two (header-fallback path) — they now exercise the "no authContext" branch, which is still correct behavior for the login/refresh routes:

```ts
import { RequestContextFactory } from './request-context.js';

describe('RequestContextFactory', () => {
  it('returns req.authContext directly when present, ignoring headers', () => {
    const factory = new RequestContextFactory();
    const req = {
      header: () => {
        throw new Error('should not read headers when authContext is present');
      },
      authContext: {
        accountId: 'acc-1',
        hospitalId: 'h1',
        roles: ['Doctor'],
        permissions: ['clinical.notes.write'],
        patientId: undefined,
      },
    } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
      patientId: undefined,
    });
  });

  it('falls back to forwarded headers when authContext is absent (login/refresh routes)', () => {
    const factory = new RequestContextFactory();
    const headers: Record<string, string | undefined> = {
      'x-account-id': 'acc-1',
      'x-tenant-id': 'h1',
      'x-roles': 'Doctor, Nurse',
      'x-permissions': 'clinical.notes.write',
    };
    const req = { header: (name: string) => headers[name] } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: 'acc-1',
      hospitalId: 'h1',
      roles: ['Doctor', 'Nurse'],
      permissions: ['clinical.notes.write'],
      patientId: undefined,
    });
  });

  it('defaults to empty arrays and undefined fields when authContext is absent and no headers are present', () => {
    const factory = new RequestContextFactory();
    const req = { header: () => undefined } as any;

    expect(factory.fromRequest(req)).toEqual({
      accountId: undefined,
      hospitalId: undefined,
      roles: [],
      permissions: [],
      patientId: undefined,
    });
  });
});
```

- [ ] **Step 6: Update `PermissionGuard`**

Modify `libs/auth-guards/src/lib/permission.guard.ts`. Current content:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.get<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const permissionsHeader: string = request.header('x-permissions') ?? '';
    const grantedPermissions = permissionsHeader
      .split(',')
      .map((p: string) => p.trim())
      .filter(Boolean);

    if (!grantedPermissions.includes(requiredPermission)) {
      throw new ForbiddenException(
        `Missing required permission: ${requiredPermission}`,
      );
    }

    return true;
  }
}
```

Replace the body reading permissions:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.get<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const grantedPermissions: string[] = request.authContext?.permissions ?? [];

    if (!grantedPermissions.includes(requiredPermission)) {
      throw new ForbiddenException(
        `Missing required permission: ${requiredPermission}`,
      );
    }

    return true;
  }
}
```

- [ ] **Step 7: Update `permission.guard.spec.ts`**

Modify `libs/auth-guards/src/lib/permission.guard.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard.js';

describe('PermissionGuard', () => {
  function buildContext(
    permissions: string[] | undefined,
    requiredPermission: string | undefined,
  ) {
    const reflector = { get: () => requiredPermission } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = {
      authContext: permissions === undefined ? undefined : { permissions },
    };
    const context = {
      getHandler: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { guard, context };
  }

  it('allows the request when no permission is required', () => {
    const { guard, context } = buildContext(undefined, undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request when the required permission is present', () => {
    const { guard, context } = buildContext(
      ['billing.invoice.create', 'billing.invoice.read'],
      'billing.invoice.create',
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the required permission is missing', () => {
    const { guard, context } = buildContext(
      ['billing.invoice.read'],
      'billing.invoice.create',
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when req.authContext is absent entirely', () => {
    const { guard, context } = buildContext(
      undefined,
      'billing.invoice.create',
    );
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 8: Run full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS. This task only changes 3 shared lib files + their unit tests — no integration-spec files are touched yet (those are Tasks 7-11), so the full suite's integration specs will start failing at this point if any of them exercise a route that now sees `req.authContext` undefined where it previously worked via headers. **This is expected and will not be fixed until Tasks 7-11** — do not attempt to fix integration-spec failures in this task. Confirm specifically that the 4 lib-level unit-test files pass (`tenant-context.middleware.spec.ts`, `request-context.spec.ts`, `permission.guard.spec.ts`, `auth-context.middleware.spec.ts` from Task 2) and that typecheck is clean; report the full-suite integration-test failure count in your report so the controller has visibility, but do not treat it as this task's failure.

- [ ] **Step 9: Commit**

```bash
git add libs/tenant-context/src/lib/tenant-context.middleware.ts libs/tenant-context/src/lib/tenant-context.middleware.spec.ts libs/auth-guards/src/lib/request-context.ts libs/auth-guards/src/lib/request-context.spec.ts libs/auth-guards/src/lib/permission.guard.ts libs/auth-guards/src/lib/permission.guard.spec.ts
git commit -m "feat(auth): read tenant/account/permissions from req.authContext instead of headers"
```

---

### Task 4: Wire `AuthContextMiddleware` into `AppModule`

**Files:**
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `AuthContextMiddleware` (Task 2)

- [ ] **Step 1: Register the middleware ahead of `TenantContextMiddleware`, excluding login/refresh**

Modify `apps/api/src/app/app.module.ts`. Current full content:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
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
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

Replace with (only the first import line and the `configure()` method body change — the module-specific imports and the `@Module({...})` decorator's `imports` array are untouched):

```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
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
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
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

If this file has changed since this plan was written (e.g. a new module added), preserve that change — only the shown diff (import line + `configure()` body) is what this task changes.

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec nx run-many -t typecheck`
Expected: PASS, no type errors.

- [ ] **Step 3: Run full suite**

Run: `pnpm exec nx run-many -t test`
Expected: Same integration-spec failure set as Task 3, Step 8 (no new failures introduced by this task specifically — this task only changes routing/middleware order at the `AppModule` level, which affects the real app but not the ~18 integration specs that each construct their own isolated `Test.createTestingModule` rather than booting the full `AppModule`). Confirm no NEW failures beyond what Task 3 already reported.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/app/app.module.ts
git commit -m "feat(auth): wire AuthContextMiddleware into AppModule ahead of TenantContextMiddleware"
```

---

### Task 5: `type` claim on login tokens + `POST /auth/refresh`

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/dto/refresh-token.dto.ts`
- Modify: `apps/api/src/auth/auth.service.integration-spec.ts`
- Modify: `apps/api/src/auth/auth.controller.integration-spec.ts`

**Interfaces:**
- Consumes: `AccountsService.getAccountWithRoles(accountId)` (existing, returns `{ account, roleIds, roleNames } | null`), `AccountsService.getPermissionNamesForRoles(roleIds)` (existing)
- Produces: `AuthService.refresh(input: RefreshInput): Promise<RefreshResult>`, `POST /auth/refresh`

- [ ] **Step 1: Add `type` claims and a `refresh()` method to `AuthService`**

Modify `apps/api/src/auth/auth.service.ts`. Current content is shown in full in this plan's context above (imports, constants, `LoginInput`/`LoginResult`, the `AuthService` class with just a `login()` method). Replace the whole file:

```ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export interface LoginInput {
  username: string;
  password: string;
}

export type LoginResult =
  | { accessToken: string; refreshToken: string }
  | { locked: true; retryAfterSeconds: number }
  | { invalidCredentials: true };

export interface RefreshInput {
  refreshToken: string;
}

export type RefreshResult =
  | { accessToken: string; refreshToken: string }
  | { invalidToken: true };

interface RefreshTokenPayload {
  sub: string;
  hospitalId: string;
  type: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly accountsService: AccountsService,
    private readonly jwtService: JwtService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const found = await this.accountsService.findByUsernameWithRoles(input.username);
    if (!found) {
      return { invalidCredentials: true };
    }

    const { account, roleIds, roleNames } = found;

    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.ceil((account.lockedUntil.getTime() - Date.now()) / 1000);
      return { locked: true, retryAfterSeconds };
    }

    const passwordMatches =
      account.passwordHash !== null && (await bcrypt.compare(input.password, account.passwordHash));

    if (!passwordMatches) {
      await this.accountsService.recordFailedLogin(account.id);
      const updatedAttempts = account.failedLoginAttempts + 1;
      if (updatedAttempts >= MAX_FAILED_ATTEMPTS) {
        await this.accountsService.lockAccount(account.id, new Date(Date.now() + LOCKOUT_DURATION_MS));
      }
      return { invalidCredentials: true };
    }

    await this.accountsService.resetFailedLogins(account.id);

    const hospitalId = this.tenantContext.getTenantId();
    const permissions = await this.accountsService.getPermissionNamesForRoles(roleIds);
    const payload = {
      sub: account.id,
      roles: roleNames,
      permissions,
      hospitalId,
      type: 'access' as const,
    };

    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: ACCESS_TOKEN_TTL });
    const refreshToken = await this.jwtService.signAsync(
      { sub: account.id, hospitalId, type: 'refresh' as const },
      { expiresIn: REFRESH_TOKEN_TTL },
    );

    return { accessToken, refreshToken };
  }

  async refresh(input: RefreshInput): Promise<RefreshResult> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(input.refreshToken);
    } catch {
      return { invalidToken: true };
    }

    if (payload.type !== 'refresh') {
      return { invalidToken: true };
    }

    const found = await this.tenantContext.run(
      { tenantId: payload.hospitalId, correlationId: 'auth-refresh' },
      () => this.accountsService.getAccountWithRoles(payload.sub),
    );
    if (!found) {
      return { invalidToken: true };
    }

    const permissions = await this.accountsService.getPermissionNamesForRoles(found.roleIds);
    const accessPayload = {
      sub: found.account.id,
      roles: found.roleNames,
      permissions,
      hospitalId: payload.hospitalId,
      type: 'access' as const,
    };

    const accessToken = await this.jwtService.signAsync(accessPayload, { expiresIn: ACCESS_TOKEN_TTL });
    // Rotate: issue a new refresh token instead of letting the caller reuse the old one. This is
    // stateless rotation only — there is no revocation store in this codebase, so the previous
    // refresh token remains cryptographically valid until its own 7-day expiry rather than being
    // immediately invalidated (see the design spec for why this is an accepted limitation).
    const newRefreshToken = await this.jwtService.signAsync(
      { sub: found.account.id, hospitalId: payload.hospitalId, type: 'refresh' as const },
      { expiresIn: REFRESH_TOKEN_TTL },
    );
    return { accessToken, refreshToken: newRefreshToken };
  }
}
```

- [ ] **Step 2: Create `RefreshTokenDto`**

Create `apps/api/src/auth/dto/refresh-token.dto.ts`, matching `login.dto.ts`'s existing style:

```ts
export class RefreshTokenDto {
  refreshToken!: string;
}
```

- [ ] **Step 3: Add `POST /auth/refresh` to `AuthController`**

Modify `apps/api/src/auth/auth.controller.ts`. Current content:

```ts
import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';

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
}
```

Replace with:

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

- [ ] **Step 4: Add integration tests for `refresh()` to `auth.service.integration-spec.ts`**

Read the current file (already migrated onto `TenantTestContext` in the prior plan). Add new `it()` blocks alongside the existing `login()` tests (do not remove or restructure existing tests):

```ts
  it('issues a new access token from a valid refresh token, reflecting current roles', async () => {
    // Arrange: create a staff account and log in to get a refresh token, using this file's
    // existing ctx/authService/accountsService setup.
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'refresh.user',
        email: 'refreshuser@example.com',
        displayName: 'Refresh User',
        password: 'a-refresh-password',
        roleName: 'Nurse',
      }),
    );
    const loginResult = await ctx.inTenant(() =>
      authService.login({ username: 'refresh.user', password: 'a-refresh-password' }),
    );
    if (!('refreshToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    const refreshResult = await authService.refresh({ refreshToken: loginResult.refreshToken });
    expect('accessToken' in refreshResult).toBe(true);
    if ('accessToken' in refreshResult) {
      expect(typeof refreshResult.refreshToken).toBe('string');
      expect(refreshResult.refreshToken).not.toBe(loginResult.refreshToken);
    }
  });

  it('rejects refresh when given an access token instead of a refresh token', async () => {
    await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({
        username: 'refresh.wrong.token',
        email: 'refreshwrong@example.com',
        displayName: 'Refresh Wrong Token',
        password: 'a-wrong-password',
        roleName: 'Nurse',
      }),
    );
    const loginResult = await ctx.inTenant(() =>
      authService.login({ username: 'refresh.wrong.token', password: 'a-wrong-password' }),
    );
    if (!('accessToken' in loginResult)) {
      throw new Error('expected a successful login');
    }

    const refreshResult = await authService.refresh({ refreshToken: loginResult.accessToken });
    expect(refreshResult).toEqual({ invalidToken: true });
  });

  it('rejects refresh with a malformed token', async () => {
    const refreshResult = await authService.refresh({ refreshToken: 'not-a-real-token' });
    expect(refreshResult).toEqual({ invalidToken: true });
  });
```

Adapt variable names (`ctx`, `authService`, `ctx.accountsService`) to match whatever this file's already-migrated shape actually uses — read it first, this plan does not have its exact current line numbers.

- [ ] **Step 5: Add an integration test for `POST /auth/refresh` to `auth.controller.integration-spec.ts`**

Read the current file first (already migrated onto `TenantTestContext`). Add:

```ts
  it('POST /auth/refresh issues a new access token from a valid refresh token', async () => {
    // Reuse this file's existing seeded login fixture/credentials if one already exists;
    // otherwise create a staff account the same way this file's other tests do.
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-tenant-id', ctx.tenantId)
      .send({ username: '<this file's existing seeded username>', password: '<its password>' });
    expect(loginResponse.status).toBe(200);

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-tenant-id', ctx.tenantId)
      .send({ refreshToken: loginResponse.body.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(typeof refreshResponse.body.accessToken).toBe('string');
    expect(typeof refreshResponse.body.refreshToken).toBe('string');
    expect(refreshResponse.body.refreshToken).not.toBe(loginResponse.body.refreshToken);
  });

  it('POST /auth/refresh returns 401 for an invalid refresh token', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('x-tenant-id', ctx.tenantId)
      .send({ refreshToken: 'not-a-real-token' });

    expect(response.status).toBe(401);
  });
```

Note: `/auth/login` and `/auth/refresh` are excluded from `AuthContextMiddleware`, so this file's requests to these two routes still use `.set('x-tenant-id', ctx.tenantId)` (never `Authorization: Bearer`) — this is correct and matches the Global Constraints' documented login/refresh exception. Read the actual file to find its real seeded username/password before writing the first new test — do not invent one if a fixture already exists to reuse.

- [ ] **Step 6: Run the two auth spec files**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api auth.service.integration-spec auth.controller.integration-spec`
Expected: PASS, previous test counts plus 3 (service) + 2 (controller) new tests.

- [ ] **Step 7: Run full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: Same pre-existing integration-spec failure set as Task 4 (unrelated controller specs still not yet migrated), no new failures beyond that, auth-specific specs green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/auth.service.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/dto/refresh-token.dto.ts apps/api/src/auth/auth.service.integration-spec.ts apps/api/src/auth/auth.controller.integration-spec.ts
git commit -m "feat(auth): add type claim to tokens and POST /auth/refresh endpoint"
```

---

### Task 6: `signTestToken()` test helper

**Files:**
- Create: `apps/api/src/testing/test-jwt.ts`
- Create: `apps/api/src/testing/test-jwt.spec.ts`

**Interfaces:**
- Consumes: `resolveJwtSecret()` (Task 1)
- Produces: `function signTestToken(claims: { sub: string; hospitalId: string; roles?: string[]; permissions?: string[] }): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/testing/test-jwt.spec.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { signTestToken } from './test-jwt.js';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

describe('signTestToken', () => {
  it('signs a token verifiable with the same secret the app uses, defaulting roles/permissions to empty arrays', async () => {
    const token = await signTestToken({ sub: 'acc-1', hospitalId: 'h1' });
    const verifier = new JwtService({ secret: resolveJwtSecret() });

    const payload = await verifier.verifyAsync(token);
    expect(payload).toMatchObject({
      sub: 'acc-1',
      hospitalId: 'h1',
      roles: [],
      permissions: [],
      type: 'access',
    });
  });

  it('signs a token carrying the provided roles and permissions', async () => {
    const token = await signTestToken({
      sub: 'acc-2',
      hospitalId: 'h2',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
    });
    const verifier = new JwtService({ secret: resolveJwtSecret() });

    const payload = await verifier.verifyAsync(token);
    expect(payload).toMatchObject({
      sub: 'acc-2',
      hospitalId: 'h2',
      roles: ['Doctor'],
      permissions: ['clinical.notes.write'],
      type: 'access',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api test-jwt.spec`
Expected: FAIL — `Cannot find module './test-jwt.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/testing/test-jwt.ts`:

```ts
import { JwtService } from '@nestjs/jwt';
import { resolveJwtSecret } from '../auth/jwt-secret.js';

export interface TestTokenClaims {
  sub: string;
  hospitalId: string;
  roles?: string[];
  permissions?: string[];
}

export async function signTestToken(claims: TestTokenClaims): Promise<string> {
  const jwtService = new JwtService({ secret: resolveJwtSecret() });
  return jwtService.signAsync(
    {
      sub: claims.sub,
      hospitalId: claims.hospitalId,
      roles: claims.roles ?? [],
      permissions: claims.permissions ?? [],
      type: 'access',
    },
    { expiresIn: '15m' },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run the Step 1 command.
Expected: PASS, both tests green.

- [ ] **Step 5: Run full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: Same pre-existing failure set as Task 5 — this task only adds new files.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/testing/test-jwt.ts apps/api/src/testing/test-jwt.spec.ts
git commit -m "feat(testing): add signTestToken() helper for minting real JWTs in integration specs"
```

---

### Task 7: Migrate batch A — accounts (2 files, worked example)

**Files:**
- Modify: `apps/api/src/accounts/accounts.controller.integration-spec.ts`
- Modify: `apps/api/src/accounts/accounts-permission-gating.integration-spec.ts`

**Interfaces:**
- Consumes: `signTestToken` (Task 6), `AuthContextMiddleware` (Task 2)

This task establishes the migration pattern every later batch follows.

- [ ] **Step 1: Migrate `accounts.controller.integration-spec.ts` (worked example)**

Current shape (before) — shown in full in this plan's context above: constructs `adminHeaders = { 'x-tenant-id': ctx.tenantId, 'x-permissions': 'identity.accounts.manage' }`, manually instantiates and `app.use()`s only `TenantContextMiddleware`, and every request does `.set(adminHeaders)`.

Target shape (after):

```ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { AccountsModule } from './accounts.module.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';
import { signTestToken } from '../testing/test-jwt.js';

describe('AccountsController (integration)', () => {
  let app: INestApplication;
  let ctx: TenantTestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounts_controller', seedRbac: true });
    adminToken = await signTestToken({
      sub: 'accounts-controller-admin',
      hospitalId: ctx.tenantId,
      permissions: ['identity.accounts.manage'],
    });

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(DataSource)
      .useValue(ctx.dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const jwtService = moduleRef.get(JwtService, { strict: false }) ?? new JwtService();

    app = moduleRef.createNestApplication();
    app.use(
      new AuthContextMiddleware(jwtService).use.bind(new AuthContextMiddleware(jwtService)),
    );
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await teardownTenantTestContext(ctx);
    await app.close();
  });

  it('creates a staff account with needsPasswordUpdate set, and never returns passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ /* ... unchanged ... */ });
    // ... unchanged assertions
  });

  // ... every other it() block: `.set(adminHeaders)` -> `.set('Authorization', \`Bearer ${adminToken}\`)`
});
```

**Important — `JwtService` resolution problem to solve for real, don't leave the `?? new JwtService()` placeholder above as-is:** `AccountsModule` does not import `JwtModule` at all, so `moduleRef.get(JwtService, { strict: false })` will return `undefined`, and a bare `new JwtService()` has no secret configured — verification would use `undefined` as the secret, which will NOT match tokens signed by `signTestToken()` (which uses `resolveJwtSecret()`). Fix this properly: construct the `AuthContextMiddleware` with its own `JwtService` built the same way `signTestToken` builds one:

```ts
import { resolveJwtSecret } from '../auth/jwt-secret.js';
// ...
const jwtService = new JwtService({ secret: resolveJwtSecret() });
app.use(new AuthContextMiddleware(jwtService).use.bind(new AuthContextMiddleware(jwtService)));
```

This guarantees the middleware verifies with the exact same secret `signTestToken()` signs with, with no DI dependency on `AccountsModule` having `JwtModule` imported. Use this corrected pattern, not the placeholder shown first.

- [ ] **Step 2: Run the migrated file's test**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api accounts.controller.integration-spec`
Expected: PASS, same test count as before migration.

- [ ] **Step 3: Migrate `accounts-permission-gating.integration-spec.ts`**

Apply the identical transformation. Current shape (shown in full in this plan's context above): `noPermissionHeaders = { 'x-tenant-id': ctx.tenantId }` (no permissions at all). Target: `noPermissionToken = await signTestToken({ sub: 'accounts-permgate-user', hospitalId: ctx.tenantId })` (permissions omitted → defaults to `[]` per Task 6's helper) — every `.set(noPermissionHeaders)` becomes `.set('Authorization', \`Bearer ${noPermissionToken}\`)`. Wire `AuthContextMiddleware` into this file's manually-constructed app the same way as Step 1, using the same `new JwtService({ secret: resolveJwtSecret() })` construction (not DI resolution).

- [ ] **Step 4: Run both files together, then the full suite**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api accounts.controller.integration-spec accounts-permission-gating.integration-spec`
Expected: PASS, same test counts as before.

Run: `pnpm exec nx run-many -t typecheck test`
Expected: These two files' tests now pass; every other not-yet-migrated controller-style spec still fails the same way it did after Task 3 (expected, tracked, fixed in later tasks).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/accounts/accounts.controller.integration-spec.ts apps/api/src/accounts/accounts-permission-gating.integration-spec.ts
git commit -m "refactor(testing): migrate accounts controller specs onto real JWTs"
```

---

### Task 8: Migrate batch B — auth/tenants (4 files)

**Files:**
- Modify: `apps/api/src/auth/auth.controller.integration-spec.ts`
- Modify: `apps/api/src/auth/cross-tenant-login.integration-spec.ts`
- Modify: `apps/api/src/tenants/tenants.controller.integration-spec.ts`
- Modify: `apps/api/src/tenants/tenants-permission-gating.integration-spec.ts`

**Interfaces:**
- Consumes: `signTestToken` (Task 6), `AuthContextMiddleware` (Task 2)

- [ ] **Step 1: Migrate each file**

Apply Task 7's established transformation to each file — read it fully first, this is not a blind find/replace:

- `auth.controller.integration-spec.ts` — this file's own subject is `/auth/login` and (after Task 5) `/auth/refresh`, both excluded from `AuthContextMiddleware`. Its requests to those two routes keep using `.set('x-tenant-id', ctx.tenantId)`, never a Bearer token (per the Global Constraints' documented exception). If this file also makes requests to any OTHER route (check for it) that currently uses headers for permissions, migrate only that other route's requests to `signTestToken()`. Still wire `AuthContextMiddleware` into this file's app construction ahead of `TenantContextMiddleware` (using `new JwtService({ secret: resolveJwtSecret() })`, per Task 7's corrected pattern) even though login/refresh themselves are excluded from it — needed so any other route this file might hit is still correctly protected.
- `cross-tenant-login.integration-spec.ts` — same login-route exception as above. This file is two-tenant (per the earlier tenant-migration plan) — if it makes authenticated requests to non-login routes for two different tenants, mint two separate tokens (`ctx`'s and the second tenant's, via `ctx.createTenant()`'s tenantId), matching each request to the tenant it's testing.
- `tenants.controller.integration-spec.ts`, `tenants-permission-gating.integration-spec.ts` — standard controller-spec transformation, no login-route exception (these hit `/tenants`, not `/auth/*`). Both need `permissions: ['system-admin.tenants.manage']` on their admin token (per `TenantsController`'s `REQUIRED_PERMISSION`); `tenants-permission-gating` additionally needs a no-permission token for its negative-permission tests.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api auth.controller.integration-spec cross-tenant-login tenants.controller.integration-spec tenants-permission-gating.integration-spec`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: These 4 files now pass; unrelated not-yet-migrated files still fail the same tracked way.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.controller.integration-spec.ts apps/api/src/auth/cross-tenant-login.integration-spec.ts apps/api/src/tenants/tenants.controller.integration-spec.ts apps/api/src/tenants/tenants-permission-gating.integration-spec.ts
git commit -m "refactor(testing): migrate auth/tenants controller specs onto real JWTs"
```

---

### Task 9: Migrate batch C — admissions/appointments/master-data/patients (5 files)

**Files:**
- Modify: `apps/api/src/admissions/admissions.controller.integration-spec.ts`
- Modify: `apps/api/src/appointments/appointments.controller.integration-spec.ts`
- Modify: `apps/api/src/master-data/master-data.controller.integration-spec.ts`
- Modify: `apps/api/src/master-data/master-data-permission-gating.integration-spec.ts`
- Modify: `apps/api/src/patients/patients.controller.integration-spec.ts`

**Interfaces:**
- Consumes: `signTestToken` (Task 6), `AuthContextMiddleware` (Task 2)

- [ ] **Step 1: Migrate each file**

Apply Task 7's established transformation. Per-file notes:

- `admissions.controller.integration-spec.ts`, `appointments.controller.integration-spec.ts` — per the prior tenant-migration plan's notes, these files' `TEST_TENANT_ID` was never referenced inside test bodies (no permission header set either — both tests check plain 401/403 with no auth at all). After this migration, a request with NO `Authorization` header at all should now get 401 from `AuthContextMiddleware` itself (rather than whatever produced 401/403 before) — read each test's assertion carefully; if a test currently expects 403 without ever sending identity, it may need updating to expect 401 instead, since there's now a real authentication layer in front of the permission layer. Do not guess — run the test after your change and read the actual status code Nest returns, then confirm it matches what the test asserts (401, since no token means `AuthContextMiddleware` itself rejects, never reaching `PermissionGuard`); adjust the assertion if the plan's assumption here is wrong for either file.
- `master-data.controller.integration-spec.ts`, `patients.controller.integration-spec.ts` — call `seedRbacCatalog` per the prior migration's notes (both pass `seedRbac: true` already); mint admin tokens with whatever specific permission(s) each file's existing `adminHeaders`/`fullPermHeaders` used.
- `master-data-permission-gating.integration-spec.ts` — this file keeps a DI-resolved `tenantContext.run(...)` for its own fixture setup (per the prior migration's rule-10 finding, already commented in the file) — that part is unaffected by this task; only its HTTP-request-side headers change to tokens.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api admissions.controller appointments.controller master-data.controller master-data-permission-gating patients.controller`
Expected: PASS, same test counts as before (with the possible 403→401 assertion correction noted above).

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: These 5 files now pass; unrelated not-yet-migrated files still fail the same tracked way.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/admissions/admissions.controller.integration-spec.ts apps/api/src/appointments/appointments.controller.integration-spec.ts apps/api/src/master-data/master-data.controller.integration-spec.ts apps/api/src/master-data/master-data-permission-gating.integration-spec.ts apps/api/src/patients/patients.controller.integration-spec.ts
git commit -m "refactor(testing): migrate admissions/appointments/master-data/patients controller specs onto real JWTs"
```

---

### Task 10: Migrate batch D — billing (3 files)

**Files:**
- Modify: `apps/api/src/billing/billing-settings.controller.integration-spec.ts`
- Modify: `apps/api/src/billing/deposits.controller.integration-spec.ts`
- Modify: `apps/api/src/billing/invoices.controller.integration-spec.ts`

**Interfaces:**
- Consumes: `signTestToken` (Task 6), `AuthContextMiddleware` (Task 2)

- [ ] **Step 1: Migrate each file**

Apply Task 7's established transformation. Per the prior tenant-migration plan's notes, these three are AppModule-boot with no `overrideProvider(DataSource)` and their `TEST_TENANT_ID` literal was never referenced in any `it()` body (no header-based auth was ever exercised in these three — verify this is still true; if any test does check for a 403 without sending any identity, apply the same 401-vs-403 correction described in Task 9, Step 1).

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api billing-settings.controller deposits.controller invoices.controller`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: These 3 files now pass; unrelated not-yet-migrated files still fail the same tracked way.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/billing/billing-settings.controller.integration-spec.ts apps/api/src/billing/deposits.controller.integration-spec.ts apps/api/src/billing/invoices.controller.integration-spec.ts
git commit -m "refactor(testing): migrate billing controller specs onto real JWTs"
```

---

### Task 11: Migrate batch E — clinical/orders (LAST migration batch, 4 files)

**Files:**
- Modify: `apps/api/src/clinical/encounters/encounters.controller.integration-spec.ts`
- Modify: `apps/api/src/clinical/triage/triage.controller.integration-spec.ts`
- Modify: `apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts`
- Modify: `apps/api/src/orders/orders.controller.integration-spec.ts`

**Interfaces:**
- Consumes: `signTestToken` (Task 6), `AuthContextMiddleware` (Task 2)

- [ ] **Step 1: Migrate each file**

Apply Task 7's established transformation. `encounters.controller.integration-spec.ts` in particular has a documented history in this codebase (an earlier session found and fixed a same-object double-destroy bug there) — read it carefully, and confirm the migration doesn't touch anything about its `DataSource`/teardown lifecycle, only the auth-header-to-token swap and wiring `AuthContextMiddleware` alongside its existing `TenantContextMiddleware` construction. All 4 files per the prior tenant-migration plan's notes had no permission-header assertions beyond plain 401/403 checks with no headers set at all — apply the same 401-vs-403 correction from Task 9, Step 1 if a test's current expectation no longer matches once real auth is in front.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api encounters.controller triage.controller vitals.controller orders.controller`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: **All integration specs pass now** — this is the last migration batch. Every file that referenced `x-tenant-id`/`x-permissions`/`x-roles`/`x-patient-id` for identity (not for the documented login/refresh exception) should now be using real tokens. Confirm the full suite is 100% green, with zero known-tracked failures remaining.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/clinical/encounters/encounters.controller.integration-spec.ts apps/api/src/clinical/triage/triage.controller.integration-spec.ts apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts apps/api/src/orders/orders.controller.integration-spec.ts
git commit -m "refactor(testing): migrate clinical/orders controller specs onto real JWTs"
```

---

### Task 12: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`
- Modify: `new/docs/technical-design/review-comments.md` (mark the JWT finding resolved, don't delete it — it's a historical record)

**Interfaces:**
- Consumes: nothing (docs only)

- [ ] **Step 1: Document the new auth pattern**

Add a short "Request authentication" section to `Development-Standards.md`'s testing/architecture area (read the file first to find the right spot, likely near the "Tenant-scoped integration tests" section added by the prior plan) covering:
- Every request except `POST /auth/login`/`POST /auth/refresh` requires `Authorization: Bearer <token>`, verified by `AuthContextMiddleware`.
- `req.authContext` is the single source of truth for identity/tenant/permissions downstream — `TenantContextMiddleware`, `RequestContextFactory`, `PermissionGuard` all read it.
- Login/refresh are the one legitimate exception (header-based tenant hint for login; refresh is self-sufficient from its own token claim) — explain why, briefly.
- Tests use `signTestToken()` (`apps/api/src/testing/test-jwt.ts`) to mint real tokens — link the file.

- [ ] **Step 2: Check off `pending-tasks.md` Phase 1 item 2**

Change:
```markdown
2. **JWT-backed request auth** (new-features.md #1) — root cause. Every protected route
```
to:
```markdown
2. [x] **JWT-backed request auth** (new-features.md #1) — done: `AuthContextMiddleware`
   (`libs/auth-guards`), `POST /auth/refresh`, all controller-style integration specs migrated
   onto real tokens via `signTestToken()`. Root cause. Every protected route
```

- [ ] **Step 3: Update the `review-comments.md` finding**

Find the "High: Authorization and tenant selection are documented as JWT-backed, but current code
trusts request headers" finding. Add a one-line note directly under its heading (don't delete the
finding — it's the historical record of what was found):
```markdown
**Resolved:** `AuthContextMiddleware` now verifies `Authorization: Bearer <token>` on every route
except `/auth/login`/`/auth/refresh`; see `new/docs/superpowers/plans/2026-08-03-jwt-request-authentication.md`.
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md new/docs/technical-design/review-comments.md
git commit -m "docs: document JWT request authentication, check off Phase 1 item 2"
```
