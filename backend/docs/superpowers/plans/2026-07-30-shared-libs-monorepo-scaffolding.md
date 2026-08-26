# Shared Libraries & Monorepo Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Nx backend monorepo and implement the three shared libraries (`@hospital/tenant-context`, `@hospital/auth-guards`, `@hospital/audit-emitter`) that every Phase 0 service depends on, with full unit test coverage, before any individual service is built.

**Architecture:** One Nx workspace at `new/code/` using pnpm workspaces. Three independent TypeScript libraries under `libs/`, each importable as `@hospital/<name>`. No service, database, or message broker exists yet — these libraries are pure logic plus NestJS wiring, fully unit-testable in isolation via mocked request/TypeORM-event objects.

**Tech Stack:** Node 20 LTS, TypeScript, NestJS conventions (decorators, DI), Nx (decided 2026-07-30 over Turborepo for native affected-only detection and NestJS generators), pnpm, Jest.

## Global Constraints

- Node 20 LTS (PRD §4).
- Package manager: pnpm (PRD §9.4).
- Monorepo tool: Nx (PRD §9.4, decided 2026-07-30).
- All shared libraries live under `new/code/libs/`, importable as `@hospital/<name>` (PRD §9.4).
- No cross-service database access anywhere, ever (PRD G2) — not applicable to this plan directly (no service exists yet) but constrains every library's design: none of these libraries opens a database connection or owns any schema.

---

## File Structure

```
new/code/
  nx.json
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  libs/
    tenant-context/
      src/
        index.ts
        lib/
          tenant-context.service.ts
          tenant-context.service.spec.ts
          tenant-context.middleware.ts
          tenant-context.middleware.spec.ts
          tenant-context.module.ts
    auth-guards/
      src/
        index.ts
        lib/
          require-permission.decorator.ts
          require-permission.decorator.spec.ts
          permission.guard.ts
          permission.guard.spec.ts
          request-context.ts
          request-context.spec.ts
    audit-emitter/
      src/
        index.ts
        lib/
          audit-exclude.decorator.ts
          audit-exclude.decorator.spec.ts
          build-audit-diff.ts
          build-audit-diff.spec.ts
          audit-event-publisher.interface.ts
          audit.subscriber.ts
          audit.subscriber.spec.ts
          audit-emitter.module.ts
```

---

### Task 1: Nx Workspace Scaffolding

**Files:**
- Create: `new/code/` (entire Nx workspace, generated)

**Interfaces:**
- Produces: a working `new/code/` Nx workspace with `pnpm exec nx <command>` runnable from that directory. All later tasks run inside `new/code/`.

- [ ] **Step 1: Scaffold the Nx workspace**

Run from the repo root:

```bash
cd new
npx create-nx-workspace@latest code --preset=ts --packageManager=pnpm --nxCloud=skip
```

This creates `new/code/` as a bare TypeScript Nx workspace (no default app — services are scaffolded individually in their own future plans).

- [ ] **Step 2: Add the NestJS Nx plugin**

```bash
cd new/code
pnpm add -D @nx/nest
```

- [ ] **Step 3: Verify the workspace is functional**

```bash
pnpm exec nx --version
```

Expected: prints an Nx version number with no errors. This confirms the workspace and plugin installed correctly before building anything on top of it.

- [ ] **Step 4: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code
git commit -m "chore: scaffold Nx monorepo for backend services"
```

---

### Task 2: `@hospital/tenant-context` Library

**Files:**
- Create: `new/code/libs/tenant-context/src/index.ts`
- Create: `new/code/libs/tenant-context/src/lib/tenant-context.service.ts`
- Create: `new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts`
- Create: `new/code/libs/tenant-context/src/lib/tenant-context.module.ts`
- Test: `new/code/libs/tenant-context/src/lib/tenant-context.service.spec.ts`
- Test: `new/code/libs/tenant-context/src/lib/tenant-context.middleware.spec.ts`

**Interfaces:**
- Produces: `TenantContextService` with `run(store: RequestContextStore, callback)`, `getTenantId(): string | undefined`, `getAccountId(): string | undefined`, `getCorrelationId(): string | undefined`, `getSchemaName(): string | undefined`. `TenantContextMiddleware` (apply via `consumer.apply(TenantContextMiddleware).forRoutes('*')` in a future service's `AppModule`). `TenantContextModule` (`@Global()`, exports `TenantContextService`).
- Consumed by: Task 4's `AuditSubscriber` (for `hospitalId`/`accountId`/`correlationId` on every audit event) and every future service (for Postgres `search_path` resolution, per PRD §4 — the actual TypeORM `search_path` wiring is deferred to the first service that has a real database, since it can't be meaningfully tested without one).

Per the design spec (`docs/superpowers/specs/2026-07-30-identity-access-service-design.md` and PRD §4), the API Gateway forwards trusted claims as headers to backend services after JWT validation: `x-tenant-id`, `x-account-id`. This library also propagates a correlation id (incoming via `x-correlation-id`, or freshly generated) across the whole request lifecycle — every service and the shared `@hospital/audit-emitter` library need this same value to survive async boundaries (e.g. a TypeORM subscriber firing after the HTTP handler has already returned), which is exactly what `AsyncLocalStorage` is for.

- [ ] **Step 1: Generate the library scaffold**

```bash
cd new/code
pnpm exec nx g @nx/js:library tenant-context --directory=libs/tenant-context --importPath=@hospital/tenant-context --unitTestRunner=jest --bundler=none
pnpm add @nestjs/common express
pnpm add -D @types/express
```

- [ ] **Step 2: Write the failing test for `TenantContextService`**

Create `new/code/libs/tenant-context/src/lib/tenant-context.service.spec.ts`:

```typescript
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  it('returns undefined for all fields outside of a run() call', () => {
    const service = new TenantContextService();
    expect(service.getTenantId()).toBeUndefined();
    expect(service.getAccountId()).toBeUndefined();
    expect(service.getCorrelationId()).toBeUndefined();
    expect(service.getSchemaName()).toBeUndefined();
  });

  it('returns the values set for the current run() scope', () => {
    const service = new TenantContextService();
    service.run({ tenantId: 'h1', accountId: 'acc-1', correlationId: 'corr-1' }, () => {
      expect(service.getTenantId()).toBe('h1');
      expect(service.getAccountId()).toBe('acc-1');
      expect(service.getCorrelationId()).toBe('corr-1');
      expect(service.getSchemaName()).toBe('tenant_h1');
    });
  });

  it('isolates context across concurrent async run() calls', async () => {
    const service = new TenantContextService();
    const results: string[] = [];

    await Promise.all([
      service.run({ tenantId: 'h1', correlationId: 'c1' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(service.getTenantId() as string);
      }),
      service.run({ tenantId: 'h2', correlationId: 'c2' }, async () => {
        results.push(service.getTenantId() as string);
      }),
    ]);

    expect(results.sort()).toEqual(['h1', 'h2']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm exec nx test tenant-context
```

Expected: FAIL — `tenant-context.service` module not found.

- [ ] **Step 4: Implement `TenantContextService`**

Create `new/code/libs/tenant-context/src/lib/tenant-context.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  tenantId?: string;
  accountId?: string;
  correlationId: string;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextStore>();

  run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  getAccountId(): string | undefined {
    return this.storage.getStore()?.accountId;
  }

  getCorrelationId(): string | undefined {
    return this.storage.getStore()?.correlationId;
  }

  getSchemaName(): string | undefined {
    const tenantId = this.getTenantId();
    return tenantId ? `tenant_${tenantId}` : undefined;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm exec nx test tenant-context
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing test for `TenantContextMiddleware`**

Create `new/code/libs/tenant-context/src/lib/tenant-context.middleware.spec.ts`:

```typescript
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextMiddleware', () => {
  function buildRequest(headers: Record<string, string | undefined>) {
    return { header: (name: string) => headers[name] } as any;
  }

  it('propagates tenant id, account id, and an incoming correlation id from headers', () => {
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

    expect(observed).toEqual({ tenantId: 'h1', accountId: 'acc-1', correlationId: 'corr-1' });
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

  it('calls next() even when tenant id and account id headers are absent', () => {
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

- [ ] **Step 7: Run the test to verify it fails**

```bash
pnpm exec nx test tenant-context
```

Expected: FAIL — `tenant-context.middleware` module not found.

- [ ] **Step 8: Implement `TenantContextMiddleware`**

Create `new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts`:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly tenantContext: TenantContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const tenantId = req.header('x-tenant-id') || undefined;
    const accountId = req.header('x-account-id') || undefined;
    const correlationId = req.header('x-correlation-id') || randomUUID();

    this.tenantContext.run({ tenantId, accountId, correlationId }, () => next());
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
pnpm exec nx test tenant-context
```

Expected: PASS, 6 tests total.

- [ ] **Step 10: Create the module and public exports**

Create `new/code/libs/tenant-context/src/lib/tenant-context.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantContextModule {}
```

Replace the contents of `new/code/libs/tenant-context/src/index.ts`:

```typescript
export * from './lib/tenant-context.service';
export * from './lib/tenant-context.middleware';
export * from './lib/tenant-context.module';
```

- [ ] **Step 11: Run the full library test suite one more time**

```bash
pnpm exec nx test tenant-context
```

Expected: PASS, 6 tests total, no regressions.

- [ ] **Step 12: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/libs/tenant-context
git commit -m "feat: add @hospital/tenant-context library"
```

---

### Task 3: `@hospital/auth-guards` Library

**Files:**
- Create: `new/code/libs/auth-guards/src/index.ts`
- Create: `new/code/libs/auth-guards/src/lib/require-permission.decorator.ts`
- Create: `new/code/libs/auth-guards/src/lib/permission.guard.ts`
- Create: `new/code/libs/auth-guards/src/lib/request-context.ts`
- Test: `new/code/libs/auth-guards/src/lib/require-permission.decorator.spec.ts`
- Test: `new/code/libs/auth-guards/src/lib/permission.guard.spec.ts`
- Test: `new/code/libs/auth-guards/src/lib/request-context.spec.ts`

**Interfaces:**
- Produces: `RequirePermission(permission: string)` decorator, `REQUIRED_PERMISSION_KEY` metadata key, `PermissionGuard` (implements `CanActivate`), `RequestContextFactory` with `fromRequest(req): RequestContext` returning `{ accountId, hospitalId, roles: string[], permissions: string[], patientId }`.
- Consumes: nothing from Task 2 — this library reads its own headers (`x-roles`, `x-permissions`, `x-patient-id`) directly, separate from `TenantContextService`'s `AsyncLocalStorage`-propagated fields, because permission checks happen synchronously within the request handler and don't need to survive an async boundary the way audit events do.

Per PRD §6.2, the API Gateway does the coarse-grained route-level permission check; each service does its own fine-grained, resource-level check using the same forwarded claims. This library is that fine-grained mechanism.

- [ ] **Step 1: Generate the library scaffold**

```bash
cd new/code
pnpm exec nx g @nx/js:library auth-guards --directory=libs/auth-guards --importPath=@hospital/auth-guards --unitTestRunner=jest --bundler=none
```

- [ ] **Step 2: Write the failing test for `RequirePermission`**

Create `new/code/libs/auth-guards/src/lib/require-permission.decorator.spec.ts`:

```typescript
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY, RequirePermission } from './require-permission.decorator';

describe('RequirePermission', () => {
  it('sets the required-permission metadata on the handler', () => {
    class TestController {
      @RequirePermission('billing.invoice.create')
      handler() {
        return undefined;
      }
    }

    const reflector = new Reflector();
    const value = reflector.get(REQUIRED_PERMISSION_KEY, TestController.prototype.handler);
    expect(value).toBe('billing.invoice.create');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm exec nx test auth-guards
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `RequirePermission`**

Create `new/code/libs/auth-guards/src/lib/require-permission.decorator.ts`:

```typescript
import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm exec nx test auth-guards
```

Expected: PASS, 1 test.

- [ ] **Step 6: Write the failing tests for `PermissionGuard`**

Create `new/code/libs/auth-guards/src/lib/permission.guard.spec.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';

describe('PermissionGuard', () => {
  function buildContext(permissionsHeader: string | undefined, requiredPermission: string | undefined) {
    const reflector = { get: () => requiredPermission } as unknown as Reflector;
    const guard = new PermissionGuard(reflector);
    const request = {
      header: (name: string) => (name === 'x-permissions' ? permissionsHeader : undefined),
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
      'billing.invoice.create,billing.invoice.read',
      'billing.invoice.create',
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException when the required permission is missing', () => {
    const { guard, context } = buildContext('billing.invoice.read', 'billing.invoice.create');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when the permissions header is absent entirely', () => {
    const { guard, context } = buildContext(undefined, 'billing.invoice.create');
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
pnpm exec nx test auth-guards
```

Expected: FAIL — `permission.guard` module not found.

- [ ] **Step 8: Implement `PermissionGuard`**

Create `new/code/libs/auth-guards/src/lib/permission.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';

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
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }

    return true;
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm exec nx test auth-guards
```

Expected: PASS, 5 tests total.

- [ ] **Step 10: Write the failing tests for `RequestContextFactory`**

Create `new/code/libs/auth-guards/src/lib/request-context.spec.ts`:

```typescript
import { RequestContextFactory } from './request-context';

describe('RequestContextFactory', () => {
  it('builds a request context from forwarded headers', () => {
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

  it('defaults to empty arrays and undefined fields when no headers are present', () => {
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

- [ ] **Step 11: Run the tests to verify they fail**

```bash
pnpm exec nx test auth-guards
```

Expected: FAIL — `request-context` module not found.

- [ ] **Step 12: Implement `RequestContextFactory`**

Create `new/code/libs/auth-guards/src/lib/request-context.ts`:

```typescript
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

- [ ] **Step 13: Run the full library test suite**

```bash
pnpm exec nx test auth-guards
```

Expected: PASS, 7 tests total.

- [ ] **Step 14: Create public exports**

Replace the contents of `new/code/libs/auth-guards/src/index.ts`:

```typescript
export * from './lib/require-permission.decorator';
export * from './lib/permission.guard';
export * from './lib/request-context';
```

- [ ] **Step 15: Run the full library test suite one more time**

```bash
pnpm exec nx test auth-guards
```

Expected: PASS, 7 tests total, no regressions.

- [ ] **Step 16: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/libs/auth-guards
git commit -m "feat: add @hospital/auth-guards library"
```

---

### Task 4: `@hospital/audit-emitter` Library

**Files:**
- Create: `new/code/libs/audit-emitter/src/index.ts`
- Create: `new/code/libs/audit-emitter/src/lib/audit-exclude.decorator.ts`
- Create: `new/code/libs/audit-emitter/src/lib/build-audit-diff.ts`
- Create: `new/code/libs/audit-emitter/src/lib/audit-event-publisher.interface.ts`
- Create: `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts`
- Create: `new/code/libs/audit-emitter/src/lib/audit-emitter.module.ts`
- Test: `new/code/libs/audit-emitter/src/lib/audit-exclude.decorator.spec.ts`
- Test: `new/code/libs/audit-emitter/src/lib/build-audit-diff.spec.ts`
- Test: `new/code/libs/audit-emitter/src/lib/audit.subscriber.spec.ts`

**Interfaces:**
- Consumes: `TenantContextService` from `@hospital/tenant-context` (Task 2) — `getTenantId()`, `getAccountId()`, `getCorrelationId()`.
- Produces: `@AuditExclude()` property decorator, `getAuditExcludedFields(entityClass): string[]`, `buildAuditDiff(entityClass, before, after): AuditDiffEntry[]`, `AuditEvent` interface, `AuditEventPublisher` interface + `AUDIT_EVENT_PUBLISHER` DI token, `AuditSubscriber` (TypeORM `EntitySubscriberInterface`). A real RabbitMQ-backed implementation of `AuditEventPublisher` is deferred to whichever service plan first needs to actually publish to the bus — this library defines the contract and the diff-building logic, which is what's actually testable without a broker.

Per the Audit Service design spec, sensitive fields (password hashes, OTP codes, refresh-token hashes) must never appear in a captured diff. This is enforced structurally here: `buildAuditDiff` drops excluded fields before a diff entry is ever created, not after.

- [ ] **Step 1: Generate the library scaffold**

```bash
cd new/code
pnpm exec nx g @nx/js:library audit-emitter --directory=libs/audit-emitter --importPath=@hospital/audit-emitter --unitTestRunner=jest --bundler=none
pnpm add typeorm reflect-metadata
```

- [ ] **Step 2: Write the failing tests for `@AuditExclude`**

Create `new/code/libs/audit-emitter/src/lib/audit-exclude.decorator.spec.ts`:

```typescript
import 'reflect-metadata';
import { AuditExclude, getAuditExcludedFields } from './audit-exclude.decorator';

describe('AuditExclude', () => {
  it('records decorated property names on the class', () => {
    class Account {
      username!: string;
      @AuditExclude()
      passwordHash!: string;
      @AuditExclude()
      otpCode!: string;
    }

    expect(getAuditExcludedFields(Account)).toEqual(['passwordHash', 'otpCode']);
  });

  it('returns an empty array for a class with no excluded fields', () => {
    class PlainEntity {
      name!: string;
    }

    expect(getAuditExcludedFields(PlainEntity)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm exec nx test audit-emitter
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `@AuditExclude`**

Create `new/code/libs/audit-emitter/src/lib/audit-exclude.decorator.ts`:

```typescript
import 'reflect-metadata';

const AUDIT_EXCLUDE_KEY = 'auditExcludeFields';

export function AuditExclude(): PropertyDecorator {
  return (target, propertyKey) => {
    const existing: string[] = Reflect.getMetadata(AUDIT_EXCLUDE_KEY, target.constructor) ?? [];
    Reflect.defineMetadata(
      AUDIT_EXCLUDE_KEY,
      [...existing, propertyKey.toString()],
      target.constructor,
    );
  };
}

export function getAuditExcludedFields(entityClass: () => void): string[] {
  return Reflect.getMetadata(AUDIT_EXCLUDE_KEY, entityClass) ?? [];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm exec nx test audit-emitter
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Write the failing tests for `buildAuditDiff`**

Create `new/code/libs/audit-emitter/src/lib/build-audit-diff.spec.ts`:

```typescript
import 'reflect-metadata';
import { AuditExclude } from './audit-exclude.decorator';
import { buildAuditDiff } from './build-audit-diff';

class Account {
  username!: string;
  @AuditExclude()
  passwordHash!: string;
}

describe('buildAuditDiff', () => {
  it('includes only fields that changed', () => {
    const diff = buildAuditDiff(
      Account,
      { username: 'alice', passwordHash: 'old-hash' },
      { username: 'alice2', passwordHash: 'old-hash' },
    );

    expect(diff).toEqual([{ field: 'username', before: 'alice', after: 'alice2' }]);
  });

  it('never includes a field marked with @AuditExclude, even when it changed', () => {
    const diff = buildAuditDiff(
      Account,
      { username: 'alice', passwordHash: 'old-hash' },
      { username: 'alice', passwordHash: 'new-hash' },
    );

    expect(diff).toEqual([]);
  });

  it('treats a null before as a create, diffing every non-excluded field', () => {
    const diff = buildAuditDiff(Account, null, { username: 'alice', passwordHash: 'hash' });
    expect(diff).toEqual([{ field: 'username', before: null, after: 'alice' }]);
  });

  it('treats a null after as a delete, diffing every non-excluded field', () => {
    const diff = buildAuditDiff(Account, { username: 'alice', passwordHash: 'hash' }, null);
    expect(diff).toEqual([{ field: 'username', before: 'alice', after: null }]);
  });
});
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
pnpm exec nx test audit-emitter
```

Expected: FAIL — `build-audit-diff` module not found.

- [ ] **Step 8: Implement `buildAuditDiff`**

Create `new/code/libs/audit-emitter/src/lib/build-audit-diff.ts`:

```typescript
import { getAuditExcludedFields } from './audit-exclude.decorator';

export interface AuditDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export function buildAuditDiff(
  entityClass: () => void,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditDiffEntry[] {
  const excluded = new Set(getAuditExcludedFields(entityClass));
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  const diff: AuditDiffEntry[] = [];
  for (const field of fields) {
    if (excluded.has(field)) {
      continue;
    }
    const beforeValue = before ? before[field] : null;
    const afterValue = after ? after[field] : null;
    if (beforeValue !== afterValue) {
      diff.push({ field, before: beforeValue ?? null, after: afterValue ?? null });
    }
  }
  return diff;
}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm exec nx test audit-emitter
```

Expected: PASS, 6 tests total.

- [ ] **Step 10: Define the publisher interface**

Create `new/code/libs/audit-emitter/src/lib/audit-event-publisher.interface.ts`:

```typescript
import { AuditDiffEntry } from './build-audit-diff';

export interface AuditEvent {
  tableName: string;
  recordId: string;
  action: 'create' | 'update' | 'delete';
  hospitalId?: string;
  changedByAccountId?: string;
  correlationId?: string;
  diff: AuditDiffEntry[];
  occurredAt: string;
}

export interface AuditEventPublisher {
  publish(event: AuditEvent): Promise<void>;
}

export const AUDIT_EVENT_PUBLISHER = Symbol('AUDIT_EVENT_PUBLISHER');
```

This has no test of its own — it's a type-only contract, nothing to execute.

- [ ] **Step 11: Write the failing tests for `AuditSubscriber`**

Create `new/code/libs/audit-emitter/src/lib/audit.subscriber.spec.ts`:

```typescript
import 'reflect-metadata';
import { InsertEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { AuditExclude } from './audit-exclude.decorator';
import { AuditEventPublisher } from './audit-event-publisher.interface';
import { AuditSubscriber } from './audit.subscriber';
import { TenantContextService } from '@hospital/tenant-context';

class Account {
  id!: string;
  username!: string;
  @AuditExclude()
  passwordHash!: string;
}

describe('AuditSubscriber', () => {
  function buildSubscriber() {
    const published: unknown[] = [];
    const publisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };
    const tenantContext = new TenantContextService();
    const subscriber = new AuditSubscriber(publisher, tenantContext);
    return { subscriber, tenantContext, published };
  }

  it('publishes a create event with the correct diff on afterInsert', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const entity = Object.assign(new Account(), { id: '1', username: 'alice', passwordHash: 'h' });
    const event = { metadata: { tableName: 'account' }, entity } as unknown as InsertEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', accountId: 'admin-1', correlationId: 'corr-1' }, () =>
      subscriber.afterInsert(event),
    );

    expect(published).toEqual([
      {
        tableName: 'account',
        recordId: '1',
        action: 'create',
        hospitalId: 'h1',
        changedByAccountId: 'admin-1',
        correlationId: 'corr-1',
        diff: [{ field: 'username', before: null, after: 'alice' }],
        occurredAt: expect.any(String),
      },
    ]);
  });

  it('publishes an update event containing only changed, non-excluded fields', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'old',
    });
    const entity = Object.assign(new Account(), { id: '1', username: 'alice2', passwordHash: 'new' });
    const event = {
      metadata: { tableName: 'account' },
      entity,
      databaseEntity,
    } as unknown as UpdateEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-2' }, () =>
      subscriber.afterUpdate(event),
    );

    expect(published).toEqual([
      expect.objectContaining({
        action: 'update',
        diff: [{ field: 'username', before: 'alice', after: 'alice2' }],
      }),
    ]);
  });

  it('does not publish when the only changed fields are audit-excluded', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'old',
    });
    const entity = Object.assign(new Account(), { id: '1', username: 'alice', passwordHash: 'new' });
    const event = {
      metadata: { tableName: 'account' },
      entity,
      databaseEntity,
    } as unknown as UpdateEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-3' }, () =>
      subscriber.afterUpdate(event),
    );

    expect(published).toEqual([]);
  });

  it('publishes a delete event on afterRemove', async () => {
    const { subscriber, tenantContext, published } = buildSubscriber();
    const databaseEntity = Object.assign(new Account(), {
      id: '1',
      username: 'alice',
      passwordHash: 'h',
    });
    const event = {
      metadata: { tableName: 'account' },
      databaseEntity,
    } as unknown as RemoveEvent<Account>;

    await tenantContext.run({ tenantId: 'h1', correlationId: 'corr-4' }, () =>
      subscriber.afterRemove(event),
    );

    expect(published).toEqual([
      expect.objectContaining({
        action: 'delete',
        diff: [{ field: 'username', before: 'alice', after: null }],
      }),
    ]);
  });
});
```

- [ ] **Step 12: Run the tests to verify they fail**

```bash
pnpm exec nx test audit-emitter
```

Expected: FAIL — `audit.subscriber` module not found.

- [ ] **Step 13: Implement `AuditSubscriber`**

Create `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
  UpdateEvent,
} from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { buildAuditDiff } from './build-audit-diff';
import { AUDIT_EVENT_PUBLISHER, AuditEventPublisher } from './audit-event-publisher.interface';

type EntityAction = 'create' | 'update' | 'delete';

@EventSubscriber()
@Injectable()
export class AuditSubscriber implements EntitySubscriberInterface {
  constructor(
    @Inject(AUDIT_EVENT_PUBLISHER) private readonly publisher: AuditEventPublisher,
    private readonly tenantContext: TenantContextService,
  ) {}

  async afterInsert(event: InsertEvent<Record<string, unknown>>): Promise<void> {
    await this.emit('create', event.metadata.tableName, event.entity, null, event.entity ?? null);
  }

  async afterUpdate(event: UpdateEvent<Record<string, unknown>>): Promise<void> {
    await this.emit(
      'update',
      event.metadata.tableName,
      event.entity ?? event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      (event.entity as Record<string, unknown>) ?? null,
    );
  }

  async afterRemove(event: RemoveEvent<Record<string, unknown>>): Promise<void> {
    await this.emit(
      'delete',
      event.metadata.tableName,
      event.databaseEntity,
      (event.databaseEntity as Record<string, unknown>) ?? null,
      null,
    );
  }

  private async emit(
    action: EntityAction,
    tableName: string,
    entityForId: Record<string, unknown> | undefined,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): Promise<void> {
    const entityClass = ((before ?? after)?.constructor ?? Object) as () => void;
    const diff = buildAuditDiff(entityClass, before, after);
    if (diff.length === 0) {
      return;
    }

    await this.publisher.publish({
      tableName,
      recordId: String(entityForId?.['id'] ?? ''),
      action,
      hospitalId: this.tenantContext.getTenantId(),
      changedByAccountId: this.tenantContext.getAccountId(),
      correlationId: this.tenantContext.getCorrelationId(),
      diff,
      occurredAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 14: Run the tests to verify they pass**

```bash
pnpm exec nx test audit-emitter
```

Expected: PASS, 10 tests total.

- [ ] **Step 15: Create the module and public exports**

Create `new/code/libs/audit-emitter/src/lib/audit-emitter.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AuditSubscriber } from './audit.subscriber';

@Module({
  providers: [AuditSubscriber],
  exports: [AuditSubscriber],
})
export class AuditEmitterModule {}
```

Note: this module does not provide `AUDIT_EVENT_PUBLISHER` — each consuming service supplies its own real (RabbitMQ-backed) implementation via `useClass`/`useFactory` when it imports `AuditEmitterModule`, since the actual broker connection is out of scope for this library.

Replace the contents of `new/code/libs/audit-emitter/src/index.ts`:

```typescript
export * from './lib/audit-exclude.decorator';
export * from './lib/build-audit-diff';
export * from './lib/audit-event-publisher.interface';
export * from './lib/audit.subscriber';
export * from './lib/audit-emitter.module';
```

- [ ] **Step 16: Run the full library test suite one more time**

```bash
pnpm exec nx test audit-emitter
```

Expected: PASS, 10 tests total, no regressions.

- [ ] **Step 17: Run every library's tests together**

```bash
pnpm exec nx run-many -t test
```

Expected: PASS across `tenant-context`, `auth-guards`, and `audit-emitter` — 23 tests total, no regressions in any library from this task's changes.

- [ ] **Step 18: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/libs/audit-emitter
git commit -m "feat: add @hospital/audit-emitter library"
```

---

## Self-Review Notes

- **Spec coverage:** `@hospital/tenant-context` covers the PRD §4 tenant-resolution mechanism's request-scoped propagation piece (schema-name derivation deferred to the first real service, since it needs an actual database to test meaningfully). `@hospital/auth-guards` covers PRD §6.2's fine-grained, in-process permission check. `@hospital/audit-emitter` covers the Audit Service design's blanket-coverage decision and mandatory sensitive-field exclusion. Nx/pnpm/Node-20 constraints from PRD §9.4/§4 are satisfied by Task 1.
- **Placeholder scan:** no TBD/TODO markers; every step has real, runnable code and commands.
- **Type consistency:** `RequestContextStore` (Task 2) is reused by name and shape in Task 4's `AuditSubscriber` via `TenantContextService`'s getters — no divergent field names between tasks. `AuditDiffEntry` (Task 4, Step 8) matches the shape asserted in Task 4's tests exactly.
