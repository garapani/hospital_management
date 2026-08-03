# Shared `inTenant()` Test Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~40 hand-rolled tenant-provisioning/teardown blocks across `apps/api/src`'s integration specs with one shared `TenantTestContext` helper, fixing an existing fixed-tenant-name collision risk along the way.

**Architecture:** A new `apps/api/src/testing/tenant-test-context.ts` module exposes `setupTenantTestContext()`/`teardownTenantTestContext()` plus a `TenantTestContext` with `inTenant()` and `createTenant()`. Every integration spec is migrated onto it, batched by domain directory. Full design rationale: `new/docs/superpowers/specs/2026-08-03-shared-tenant-test-helper-design.md`.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest. Nx workspace root: `new/code/`. All paths below are relative to `new/code/`.

## Global Constraints

- Isolation model: schema-drop only. No transaction-rollback isolation, anywhere.
- Tenant IDs: `${namePrefix}_1`, `${namePrefix}_2`, ... — sequential, deterministic, test-only. Never a timestamp or random suffix.
- `setupTenantTestContext()` must run `DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE` **before** provisioning (self-heals a schema left behind by a crashed prior run).
- `seedRbac` defaults to `false` — only pass `true` for files that create staff accounts or otherwise need seeded roles/permissions.
- No custom Jest wrapper (e.g. `describeWithTenant`) and no class-based fixture. Every file keeps its own explicit `beforeAll`/`afterAll`.
- `.js` extensions on every relative import (ESM + `nodenext` — see `new/code/CLAUDE.md`). Run `pnpm exec nx run-many -t typecheck test` before considering any task done, not just `test`.
- Never `git commit --amend`. No AI co-authorship trailer.

---

### Task 1: `TenantTestContext` module + its own tests

**Files:**
- Create: `apps/api/src/testing/tenant-test-context.ts`
- Create: `apps/api/src/testing/tenant-test-context.integration-spec.ts`

**Interfaces:**
- Produces:
  - `interface TenantTestContext { dataSource: DataSource; tenantContext: TenantContextService; tenantConnection: TenantConnectionService; accountsService: AccountsService; tenantId: string; inTenant<T>(work: () => Promise<T>): Promise<T>; createTenant(): Promise<TenantTestContext>; }`
  - `interface TenantTestContextOptions { namePrefix: string; seedRbac?: boolean; }`
  - `function setupTenantTestContext(options: TenantTestContextOptions): Promise<TenantTestContext>`
  - `function teardownTenantTestContext(ctx: TenantTestContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/testing/tenant-test-context.integration-spec.ts`:

```ts
import { DataSource } from 'typeorm';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from './tenant-test-context.js';

describe('TenantTestContext (integration)', () => {
  it('provisions a schema at a sequential tenant ID and tears it down', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_basic' });
    expect(ctx.tenantId).toBe('tt_basic_1');

    const schemas = await ctx.dataSource.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_tt_basic_1'`,
    );
    expect(schemas).toHaveLength(1);

    await teardownTenantTestContext(ctx);

    // Re-initialize a throwaway connection to check the schema is really gone — ctx.dataSource
    // is destroyed at this point.
    const check = new DataSource({ ...(ctx.dataSource.options as any) });
    await check.initialize();
    const after = await check.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'tenant_tt_basic_1'`,
    );
    expect(after).toHaveLength(0);
    expect(ctx.dataSource.isInitialized).toBe(false);
    await check.destroy();
  });

  it('runs work inside the correct tenant context via inTenant()', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_context' });
    try {
      const seenTenantId = await ctx.inTenant(async () => ctx.tenantContext.getTenantId());
      expect(seenTenantId).toBe('tt_context_1');
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('seeds the RBAC catalog when seedRbac is true', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_rbac', seedRbac: true });
    try {
      const roleCount = await ctx.dataSource.query(`SELECT count(*)::int FROM public.roles`);
      expect(roleCount[0].count).toBeGreaterThan(0);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('does not seed RBAC when seedRbac is omitted', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_norbac' });
    try {
      const roleCount = await ctx.dataSource.query(`SELECT count(*)::int FROM public.roles`);
      expect(roleCount[0].count).toBe(0);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('createTenant() produces sequential tenant IDs sharing the same connection', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_multi' });
    try {
      const ctx2 = await ctx.createTenant();
      const ctx3 = await ctx.createTenant();

      expect(ctx2.tenantId).toBe('tt_multi_2');
      expect(ctx3.tenantId).toBe('tt_multi_3');
      expect(ctx2.dataSource).toBe(ctx.dataSource);

      const schemas = await ctx.dataSource.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_tt_multi_1', 'tenant_tt_multi_2', 'tenant_tt_multi_3') ORDER BY schema_name`,
      );
      expect(schemas).toHaveLength(3);
    } finally {
      await teardownTenantTestContext(ctx);
    }
  });

  it('teardown drops every tenant schema created via createTenant(), not just the root', async () => {
    const ctx = await setupTenantTestContext({ namePrefix: 'tt_teardown_multi' });
    const ctx2 = await ctx.createTenant();
    void ctx2;

    await teardownTenantTestContext(ctx);

    const check = new DataSource({ ...(ctx.dataSource.options as any) });
    await check.initialize();
    const remaining = await check.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('tenant_tt_teardown_multi_1', 'tenant_tt_teardown_multi_2')`,
    );
    expect(remaining).toHaveLength(0);
    await check.destroy();
  });

  it('self-heals: setupTenantTestContext succeeds even if a same-named schema already exists from a crashed prior run', async () => {
    const ctx1 = await setupTenantTestContext({ namePrefix: 'tt_crash' });
    // Simulate a crashed run: leave the schema behind, do NOT call teardown, destroy only the
    // connection so a second setup can open a fresh one against the same DB.
    await ctx1.dataSource.destroy();

    const ctx2 = await setupTenantTestContext({ namePrefix: 'tt_crash' });
    try {
      expect(ctx2.tenantId).toBe('tt_crash_1');
      const roleCount = await ctx2.dataSource.query(
        `SELECT count(*)::int FROM information_schema.schemata WHERE schema_name = 'tenant_tt_crash_1'`,
      );
      expect(roleCount[0].count).toBe(1);
    } finally {
      await teardownTenantTestContext(ctx2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-test-context.integration-spec`
Expected: FAIL — `Cannot find module './tenant-test-context.js'`

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/testing/tenant-test-context.ts`:

```ts
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

export interface TenantTestContext {
  dataSource: DataSource;
  tenantContext: TenantContextService;
  tenantConnection: TenantConnectionService;
  accountsService: AccountsService;
  tenantId: string;
  inTenant<T>(work: () => Promise<T>): Promise<T>;
  createTenant(): Promise<TenantTestContext>;
}

export interface TenantTestContextOptions {
  namePrefix: string;
  seedRbac?: boolean;
}

// Keyed by the shared DataSource instance (identical across a root context and every context it
// produces via createTenant()) — this is what lets teardownTenantTestContext() drop every tenant
// schema created in a multi-tenant test with a single call, and destroy the connection exactly
// once regardless of how many tenants were created.
const tenantRegistry = new WeakMap<DataSource, string[]>();

function registerTenant(dataSource: DataSource, tenantId: string): void {
  const ids = tenantRegistry.get(dataSource) ?? [];
  ids.push(tenantId);
  tenantRegistry.set(dataSource, ids);
}

async function provisionTenant(
  dataSource: DataSource,
  accountsService: AccountsService,
  tenantId: string,
): Promise<void> {
  // Idempotent: drops any schema left behind by a crashed prior run before creating a fresh one,
  // so deterministic sequential IDs (namePrefix_1, namePrefix_2, ...) never collide across runs.
  await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  await accountsService.provisionTenantSchema(dataSource, tenantId);
  registerTenant(dataSource, tenantId);
}

function buildContext(
  dataSource: DataSource,
  tenantContext: TenantContextService,
  tenantConnection: TenantConnectionService,
  accountsService: AccountsService,
  namePrefix: string,
  sequence: { next: number },
): TenantTestContext {
  const tenantId = `${namePrefix}_${sequence.next}`;

  return {
    dataSource,
    tenantContext,
    tenantConnection,
    accountsService,
    tenantId,
    inTenant<T>(work: () => Promise<T>): Promise<T> {
      return tenantContext.run({ tenantId, correlationId: 'test' }, work);
    },
    async createTenant(): Promise<TenantTestContext> {
      sequence.next += 1;
      const nextCtx = buildContext(
        dataSource,
        tenantContext,
        tenantConnection,
        accountsService,
        namePrefix,
        sequence,
      );
      await provisionTenant(dataSource, accountsService, nextCtx.tenantId);
      return nextCtx;
    },
  };
}

export async function setupTenantTestContext(
  options: TenantTestContextOptions,
): Promise<TenantTestContext> {
  const dataSource = createDataSource();
  await dataSource.initialize();

  if (options.seedRbac) {
    await seedRbacCatalog(dataSource);
  }

  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const sequence = { next: 1 };

  const ctx = buildContext(
    dataSource,
    tenantContext,
    tenantConnection,
    accountsService,
    options.namePrefix,
    sequence,
  );
  await provisionTenant(dataSource, accountsService, ctx.tenantId);

  return ctx;
}

export async function teardownTenantTestContext(ctx: TenantTestContext): Promise<void> {
  const tenantIds = tenantRegistry.get(ctx.dataSource) ?? [ctx.tenantId];
  for (const tenantId of tenantIds) {
    await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`);
  }
  tenantRegistry.delete(ctx.dataSource);
  if (ctx.dataSource.isInitialized) {
    await ctx.dataSource.destroy();
  }
}
```

Check `apps/api/src/rbac/entities/role.entity.ts` for the actual table name if `public.roles` above doesn't match (TypeORM's default table naming may differ — verify against how `seed-rbac-catalog.integration-spec.ts` already queries roles and match that exact query).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api tenant-test-context.integration-spec`
Expected: PASS, all 7 tests green.

Then: `pnpm exec nx run-many -t typecheck test` — full suite must still be green (this task only adds new files, doesn't touch existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/testing/tenant-test-context.ts apps/api/src/testing/tenant-test-context.integration-spec.ts
git commit -m "feat(testing): add shared TenantTestContext helper"
```

---

### Task 2: Migrate batch A — accounts, audit, database (6 files, worked example)

**Files:**
- Modify: `apps/api/src/accounts/accounts.service.integration-spec.ts`
- Modify: `apps/api/src/accounts/accounts.controller.integration-spec.ts`
- Modify: `apps/api/src/accounts/accounts-permission-gating.integration-spec.ts`
- Modify: `apps/api/src/accounts/audit-wiring.integration-spec.ts`
- Modify: `apps/api/src/audit/persisting-audit-event-publisher.integration-spec.ts`
- Modify: `apps/api/src/database/tenant-connection.service.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (Task 1)

This task establishes the migration pattern every later batch follows. `accounts.service.integration-spec.ts` is the fully worked example below; apply the identical transformation to the other 5 files in this batch (each needs its own read first — this is not a blind find/replace).

- [ ] **Step 1: Migrate `accounts.service.integration-spec.ts` (worked example)**

Current shape (before):

```ts
import bcrypt from 'bcryptjs';
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { Role } from '../rbac/entities/role.entity.js';
import { AccountsService } from './accounts.service.js';
import { AccountRole } from './entities/account-role.entity.js';

describe('AccountsService (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);

  beforeAll(async () => {
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_accounts');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_accounts" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_accounts', correlationId: 'test' }, work);
  }

  it('creates a staff account with a hashed password and an assigned role', async () => {
    const account = await inTenant(() =>
      accountsService.createStaffAccount({ /* ... */ }),
    );
    // ...
  });
  // ... more it() blocks using accountsService.xxx and inTenant(...)
});
```

Target shape (after):

```ts
import bcrypt from 'bcryptjs';
import { Role } from '../rbac/entities/role.entity.js';
import { AccountRole } from './entities/account-role.entity.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

describe('AccountsService (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'accounts', seedRbac: true });
  });

  afterAll(() => teardownTenantTestContext(ctx));

  it('creates a staff account with a hashed password and an assigned role', async () => {
    const account = await ctx.inTenant(() =>
      ctx.accountsService.createStaffAccount({ /* ... unchanged ... */ }),
    );
    // ... unchanged assertions
  });
  // ... every other it() block: `accountsService.` -> `ctx.accountsService.`, `inTenant(` -> `ctx.inTenant(`
});
```

Transformation rules (apply exactly, in this order):
1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use (e.g. `Role`, `AccountRole`, `bcrypt`).
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<derive from describe() name or existing fixed tenant string>', seedRbac: <true if this file calls seedRbacCatalog today, else omit> });`.
5. Replace `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. `namePrefix` choice: use a short, file-identifying string (e.g. `'accounts'` for this file) — it does not need to match the old fixed tenant-id string verbatim, since IDs are now sequential and deterministic regardless.

- [ ] **Step 2: Run the migrated file's test**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api accounts.service.integration-spec`
Expected: PASS, same test count as before migration.

- [ ] **Step 3: Migrate the remaining 5 files in this batch**

Read each file fully, then apply the same 8 transformation rules from Step 1. Per-file notes:

- `accounts.controller.integration-spec.ts` — controller-style (boots `AppModule`). The `ctx` object still only replaces the manual schema-provisioning `dataSource`/`accountsService` — leave the `Test.createTestingModule({ imports: [AppModule] })` / `app.init()` / `app.close()` block untouched; only replace the provisioning-side `beforeAll`/`afterAll` content and any `inTenant`/`accountsService` references used for test-data setup (not the HTTP calls via `supertest`, which are unaffected).
- `accounts-permission-gating.integration-spec.ts` — uses `seedRbacCatalog`; pass `seedRbac: true`.
- `audit-wiring.integration-spec.ts` — this file boots `AccountsModule` via `Test.createTestingModule` and resolves `DataSource` via `moduleRef.get(DataSource)` (the DI-managed instance, not a manually-created one) — this file does **not** use the `createDataSource()`/manual-construction pattern the other files use, so it does **not** get migrated onto `TenantTestContext` (which always creates its own standalone `DataSource`). Leave this file as-is; note this exception in the commit message.
- `persisting-audit-event-publisher.integration-spec.ts` — uses a fixed tenant name; no RBAC seeding needed (verify by checking if it calls `seedRbacCatalog` — per the earlier survey, it does not).
- `tenant-connection.service.integration-spec.ts` — uses a fixed tenant name; no RBAC seeding needed.

- [ ] **Step 4: Run the full batch and the full suite**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api accounts audit tenant-connection`
Expected: PASS.

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS, same total test count as before this task (migration must not change behavior or coverage).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/accounts/accounts.service.integration-spec.ts \
  apps/api/src/accounts/accounts.controller.integration-spec.ts \
  apps/api/src/accounts/accounts-permission-gating.integration-spec.ts \
  apps/api/src/audit/persisting-audit-event-publisher.integration-spec.ts \
  apps/api/src/database/tenant-connection.service.integration-spec.ts
git commit -m "refactor(testing): migrate accounts/audit/database specs onto TenantTestContext"
```

Note: `audit-wiring.integration-spec.ts` is intentionally excluded (see Step 3 note) — do not `git add` it in this task.

---

### Task 3: Migrate batch B — auth, tenants (6 files)

**Files:**
- Modify: `apps/api/src/auth/auth.controller.integration-spec.ts`
- Modify: `apps/api/src/auth/auth.service.integration-spec.ts`
- Modify: `apps/api/src/auth/cross-tenant-login.integration-spec.ts`
- Modify: `apps/api/src/tenants/tenants-permission-gating.integration-spec.ts`
- Modify: `apps/api/src/tenants/tenants.controller.integration-spec.ts`
- Modify: `apps/api/src/tenants/tenants.service.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` (Task 1)

- [ ] **Step 1: Migrate each file**

Apply this transformation to each file (identical rules for every batch in this plan):

1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use.
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace the `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<short file-identifying string>', seedRbac: <true only if this file needs seeded roles/permissions, per the per-file notes below> });`.
5. Replace the `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. For files needing a second tenant, replace the second hand-provisioned tenant with `await ctx.createTenant()` instead of a second manual `provisionTenantSchema` call.
9. If the original file has header/fixture objects declared as `const` at `describe()`-body scope with a hardcoded literal tenant-id string (e.g. `const adminHeaders = { 'x-tenant-id': 'test_foo', ... }`), convert them to `let` and assign inside `beforeAll` using `ctx.tenantId` — the tenant id is only known once the async `setupTenantTestContext()` resolves. (Learned from Task 2, commit a431351: this is a mechanical consequence of moving to a dynamically-assigned tenant id, not a restructuring choice.)
10. For controller-style specs using `Test.createTestingModule(...).overrideProvider(DataSource).useValue(dataSource)`: replace `.useValue(dataSource)` with `.useValue(ctx.dataSource)`. If the file separately resolves `moduleRef.get(AccountsService)` or `moduleRef.get(TenantContextService)` solely for out-of-band fixture setup (not for wiring into the Nest DI graph, e.g. a middleware constructor argument), use `ctx.accountsService`/`ctx.tenantContext` for that fixture setup instead — same schema, same effect, keeps every file's out-of-band setup consistent. Keep DI-resolved instances only where genuinely needed for DI wiring.
11. If a file calls `tenantContext.run(...)` inline with tenant IDs other than its own single fixed tenant (e.g. ad-hoc probe/malicious-input tenant-id strings, or additional tenants not obtained via `ctx.createTenant()`), keep those as direct `ctx.tenantContext.run(...)` calls rather than `ctx.inTenant(...)` — `ctx.inTenant()` is only for work scoped to `ctx.tenantId` itself.

Per-file notes:

- `auth.controller.integration-spec.ts`, `auth.service.integration-spec.ts`, `cross-tenant-login.integration-spec.ts` — all call `seedRbacCatalog`; pass `seedRbac: true` for all three. `cross-tenant-login.integration-spec.ts` tests cross-tenant behavior — check whether it needs 2 tenants (grep it for a second tenant ID literal); if so, use `ctx.createTenant()` for the second one instead of a second hand-provisioned schema.
- `tenants-permission-gating.integration-spec.ts`, `tenants.controller.integration-spec.ts` — call `seedRbacCatalog`; pass `seedRbac: true`.
- `tenants.service.integration-spec.ts` — no RBAC seeding needed (per earlier survey, does not call `seedRbacCatalog`). This file's own subject under test is tenant *provisioning itself* — check whether its assertions depend on `accountsService.provisionTenantSchema` being called a specific number of times or with specific arguments; if the file's own test logic calls `provisionTenantSchema` directly (rather than only through setup), keep that call site as direct `ctx.accountsService.provisionTenantSchema(...)` inside the relevant `it()`, not inside the shared `beforeAll`.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api auth tenants`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/auth.controller.integration-spec.ts \
  apps/api/src/auth/auth.service.integration-spec.ts \
  apps/api/src/auth/cross-tenant-login.integration-spec.ts \
  apps/api/src/tenants/tenants-permission-gating.integration-spec.ts \
  apps/api/src/tenants/tenants.controller.integration-spec.ts \
  apps/api/src/tenants/tenants.service.integration-spec.ts
git commit -m "refactor(testing): migrate auth/tenants specs onto TenantTestContext"
```

---

### Task 4: Migrate batch C — admissions, appointments, master-data (7 files)

**Files:**
- Modify: `apps/api/src/admissions/admissions.controller.integration-spec.ts`
- Modify: `apps/api/src/admissions/admissions.service.integration-spec.ts`
- Modify: `apps/api/src/appointments/appointments.controller.integration-spec.ts`
- Modify: `apps/api/src/appointments/appointments.service.integration-spec.ts`
- Modify: `apps/api/src/master-data/master-data-permission-gating.integration-spec.ts`
- Modify: `apps/api/src/master-data/master-data.controller.integration-spec.ts`
- Modify: `apps/api/src/master-data/master-data.service.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` (Task 1)

- [ ] **Step 1: Migrate each file**

Apply this transformation to each file (identical rules for every batch in this plan):

1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use.
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace the `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<short file-identifying string>', seedRbac: <true only if this file needs seeded roles/permissions, per the per-file notes below> });`.
5. Replace the `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. For files needing a second tenant, replace the second hand-provisioned tenant with `await ctx.createTenant()` instead of a second manual `provisionTenantSchema` call.
9. If the original file has header/fixture objects declared as `const` at `describe()`-body scope with a hardcoded literal tenant-id string (e.g. `const adminHeaders = { 'x-tenant-id': 'test_foo', ... }`), convert them to `let` and assign inside `beforeAll` using `ctx.tenantId` — the tenant id is only known once the async `setupTenantTestContext()` resolves. (Learned from Task 2, commit a431351: this is a mechanical consequence of moving to a dynamically-assigned tenant id, not a restructuring choice.)
10. For controller-style specs using `Test.createTestingModule(...).overrideProvider(DataSource).useValue(dataSource)`: replace `.useValue(dataSource)` with `.useValue(ctx.dataSource)`. If the file separately resolves `moduleRef.get(AccountsService)` or `moduleRef.get(TenantContextService)` solely for out-of-band fixture setup (not for wiring into the Nest DI graph, e.g. a middleware constructor argument), use `ctx.accountsService`/`ctx.tenantContext` for that fixture setup instead — same schema, same effect, keeps every file's out-of-band setup consistent. Keep DI-resolved instances only where genuinely needed for DI wiring.
11. If a file calls `tenantContext.run(...)` inline with tenant IDs other than its own single fixed tenant (e.g. ad-hoc probe/malicious-input tenant-id strings, or additional tenants not obtained via `ctx.createTenant()`), keep those as direct `ctx.tenantContext.run(...)` calls rather than `ctx.inTenant(...)` — `ctx.inTenant()` is only for work scoped to `ctx.tenantId` itself.

Per-file notes:

- `admissions.controller.integration-spec.ts` — controller-style (boots `AppModule`); no RBAC seeding per survey.
- `admissions.service.integration-spec.ts` — uses a second tenant (multi-tenant per earlier survey) — replace its second hand-provisioned tenant with `await ctx.createTenant()`.
- `appointments.controller.integration-spec.ts` — controller-style; no RBAC seeding.
- `appointments.service.integration-spec.ts` — uses a fixed tenant name; no RBAC seeding.
- `master-data-permission-gating.integration-spec.ts`, `master-data.controller.integration-spec.ts` — call `seedRbacCatalog`; pass `seedRbac: true`.
- `master-data.service.integration-spec.ts` — uses a fixed tenant name; no RBAC seeding.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api admissions appointments master-data`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/admissions/admissions.controller.integration-spec.ts \
  apps/api/src/admissions/admissions.service.integration-spec.ts \
  apps/api/src/appointments/appointments.controller.integration-spec.ts \
  apps/api/src/appointments/appointments.service.integration-spec.ts \
  apps/api/src/master-data/master-data-permission-gating.integration-spec.ts \
  apps/api/src/master-data/master-data.controller.integration-spec.ts \
  apps/api/src/master-data/master-data.service.integration-spec.ts
git commit -m "refactor(testing): migrate admissions/appointments/master-data specs onto TenantTestContext"
```

---

### Task 5: Migrate batch D — billing (7 files)

**Files:**
- Modify: `apps/api/src/billing/billing-entities.integration-spec.ts`
- Modify: `apps/api/src/billing/billing-settings.controller.integration-spec.ts`
- Modify: `apps/api/src/billing/billing-settings.service.integration-spec.ts`
- Modify: `apps/api/src/billing/deposits.controller.integration-spec.ts`
- Modify: `apps/api/src/billing/deposits.service.integration-spec.ts`
- Modify: `apps/api/src/billing/invoices.controller.integration-spec.ts`
- Modify: `apps/api/src/billing/invoices.service.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` (Task 1)

- [ ] **Step 1: Migrate each file**

Apply this transformation to each file (identical rules for every batch in this plan):

1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use.
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace the `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<short file-identifying string>', seedRbac: <true only if this file needs seeded roles/permissions, per the per-file notes below> });`.
5. Replace the `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. For files needing a second tenant, replace the second hand-provisioned tenant with `await ctx.createTenant()` instead of a second manual `provisionTenantSchema` call.
9. If the original file has header/fixture objects declared as `const` at `describe()`-body scope with a hardcoded literal tenant-id string (e.g. `const adminHeaders = { 'x-tenant-id': 'test_foo', ... }`), convert them to `let` and assign inside `beforeAll` using `ctx.tenantId` — the tenant id is only known once the async `setupTenantTestContext()` resolves. (Learned from Task 2, commit a431351: this is a mechanical consequence of moving to a dynamically-assigned tenant id, not a restructuring choice.)
10. For controller-style specs using `Test.createTestingModule(...).overrideProvider(DataSource).useValue(dataSource)`: replace `.useValue(dataSource)` with `.useValue(ctx.dataSource)`. If the file separately resolves `moduleRef.get(AccountsService)` or `moduleRef.get(TenantContextService)` solely for out-of-band fixture setup (not for wiring into the Nest DI graph, e.g. a middleware constructor argument), use `ctx.accountsService`/`ctx.tenantContext` for that fixture setup instead — same schema, same effect, keeps every file's out-of-band setup consistent. Keep DI-resolved instances only where genuinely needed for DI wiring.
11. If a file calls `tenantContext.run(...)` inline with tenant IDs other than its own single fixed tenant (e.g. ad-hoc probe/malicious-input tenant-id strings, or additional tenants not obtained via `ctx.createTenant()`), keep those as direct `ctx.tenantContext.run(...)` calls rather than `ctx.inTenant(...)` — `ctx.inTenant()` is only for work scoped to `ctx.tenantId` itself.

Per-file notes:

- `billing-entities.integration-spec.ts` — no RBAC seeding, single tenant.
- `billing-settings.controller.integration-spec.ts`, `deposits.controller.integration-spec.ts`, `invoices.controller.integration-spec.ts` — controller-style (boot `AppModule`); no RBAC seeding.
- `billing-settings.service.integration-spec.ts`, `deposits.service.integration-spec.ts`, `invoices.service.integration-spec.ts` — all three provision a second tenant inline (per earlier survey, matches the two-tenant pattern already seen in `invoices.service.integration-spec.ts`, which this plan's design doc used as a reference example) — replace each file's second hand-provisioned tenant with `await ctx.createTenant()`. No RBAC seeding needed for any of the three.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api billing`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/billing/billing-entities.integration-spec.ts \
  apps/api/src/billing/billing-settings.controller.integration-spec.ts \
  apps/api/src/billing/billing-settings.service.integration-spec.ts \
  apps/api/src/billing/deposits.controller.integration-spec.ts \
  apps/api/src/billing/deposits.service.integration-spec.ts \
  apps/api/src/billing/invoices.controller.integration-spec.ts \
  apps/api/src/billing/invoices.service.integration-spec.ts
git commit -m "refactor(testing): migrate billing specs onto TenantTestContext"
```

---

### Task 6: Migrate batch E — clinical (encounters, triage, vitals) (6 files)

**Files:**
- Modify: `apps/api/src/clinical/encounters/encounters.controller.integration-spec.ts`
- Modify: `apps/api/src/clinical/encounters/encounters.service.integration-spec.ts`
- Modify: `apps/api/src/clinical/triage/triage.controller.integration-spec.ts`
- Modify: `apps/api/src/clinical/triage/triage.service.integration-spec.ts`
- Modify: `apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts`
- Modify: `apps/api/src/clinical/vitals/vitals.service.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` (Task 1)

- [ ] **Step 1: Migrate each file**

Apply this transformation to each file (identical rules for every batch in this plan):

1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use.
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace the `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<short file-identifying string>', seedRbac: <true only if this file needs seeded roles/permissions, per the per-file notes below> });`.
5. Replace the `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. For files needing a second tenant, replace the second hand-provisioned tenant with `await ctx.createTenant()` instead of a second manual `provisionTenantSchema` call.
9. If the original file has header/fixture objects declared as `const` at `describe()`-body scope with a hardcoded literal tenant-id string (e.g. `const adminHeaders = { 'x-tenant-id': 'test_foo', ... }`), convert them to `let` and assign inside `beforeAll` using `ctx.tenantId` — the tenant id is only known once the async `setupTenantTestContext()` resolves. (Learned from Task 2, commit a431351: this is a mechanical consequence of moving to a dynamically-assigned tenant id, not a restructuring choice.)
10. For controller-style specs using `Test.createTestingModule(...).overrideProvider(DataSource).useValue(dataSource)`: replace `.useValue(dataSource)` with `.useValue(ctx.dataSource)`. If the file separately resolves `moduleRef.get(AccountsService)` or `moduleRef.get(TenantContextService)` solely for out-of-band fixture setup (not for wiring into the Nest DI graph, e.g. a middleware constructor argument), use `ctx.accountsService`/`ctx.tenantContext` for that fixture setup instead — same schema, same effect, keeps every file's out-of-band setup consistent. Keep DI-resolved instances only where genuinely needed for DI wiring.
11. If a file calls `tenantContext.run(...)` inline with tenant IDs other than its own single fixed tenant (e.g. ad-hoc probe/malicious-input tenant-id strings, or additional tenants not obtained via `ctx.createTenant()`), keep those as direct `ctx.tenantContext.run(...)` calls rather than `ctx.inTenant(...)` — `ctx.inTenant()` is only for work scoped to `ctx.tenantId` itself.

Per-file notes:

- `encounters.controller.integration-spec.ts` — controller-style; uses a fixed tenant name today (`test_encounters_ctrl`, per the double-destroy investigation earlier in this project) — this is exactly the kind of file this migration exists to fix. No RBAC seeding.
- `encounters.service.integration-spec.ts` — uses a fixed tenant name; no RBAC seeding.
- `triage.controller.integration-spec.ts` — controller-style; no RBAC seeding.
- `triage.service.integration-spec.ts` — multi-tenant (per earlier survey) — replace its second tenant with `ctx.createTenant()`.
- `vitals.controller.integration-spec.ts` — controller-style; no RBAC seeding.
- `vitals.service.integration-spec.ts` — multi-tenant — replace its second tenant with `ctx.createTenant()`.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api encounters triage vitals`
Expected: PASS, same test counts as before.

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/clinical/encounters/encounters.controller.integration-spec.ts \
  apps/api/src/clinical/encounters/encounters.service.integration-spec.ts \
  apps/api/src/clinical/triage/triage.controller.integration-spec.ts \
  apps/api/src/clinical/triage/triage.service.integration-spec.ts \
  apps/api/src/clinical/vitals/vitals.controller.integration-spec.ts \
  apps/api/src/clinical/vitals/vitals.service.integration-spec.ts
git commit -m "refactor(testing): migrate clinical (encounters/triage/vitals) specs onto TenantTestContext"
```

---

### Task 7: Migrate batch F — orders, patients, rbac, reporting (8 files)

**Files:**
- Modify: `apps/api/src/orders/orders.controller.integration-spec.ts`
- Modify: `apps/api/src/orders/orders.service.integration-spec.ts`
- Modify: `apps/api/src/patients/patient-entities.integration-spec.ts`
- Modify: `apps/api/src/patients/patient-number-generator.service.integration-spec.ts`
- Modify: `apps/api/src/patients/patients.controller.integration-spec.ts`
- Modify: `apps/api/src/patients/patients.service.integration-spec.ts`
- Modify: `apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts`
- Modify: `apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts`

**Interfaces:**
- Consumes: `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` (Task 1)

- [ ] **Step 1: Migrate each file**

Apply this transformation to each file (identical rules for every batch in this plan):

1. Remove the now-unused imports: `TenantContextService`, `createDataSource`, `TenantConnectionService`, `seedRbacCatalog`. Keep imports the test bodies still use.
2. Add the import for `setupTenantTestContext`, `teardownTenantTestContext`, `TenantTestContext` from `../testing/tenant-test-context.js` (adjust the relative path per file's directory depth).
3. Replace the `const dataSource = ...` / `const tenantContext = ...` / `const tenantConnection = ...` / `const accountsService = ...` block with `let ctx: TenantTestContext;`.
4. Replace the `beforeAll` body with `ctx = await setupTenantTestContext({ namePrefix: '<short file-identifying string>', seedRbac: <true only if this file needs seeded roles/permissions, per the per-file notes below> });`.
5. Replace the `afterAll` body with `teardownTenantTestContext(ctx)`.
6. Delete the local `function inTenant...` — it's now `ctx.inTenant`.
7. Every call site: `accountsService.` → `ctx.accountsService.`; bare `inTenant(` → `ctx.inTenant(`; any direct `dataSource.`/`tenantConnection.`/`tenantContext.` reference in test bodies → `ctx.dataSource.`/`ctx.tenantConnection.`/`ctx.tenantContext.`.
8. For files needing a second tenant, replace the second hand-provisioned tenant with `await ctx.createTenant()` instead of a second manual `provisionTenantSchema` call.
9. If the original file has header/fixture objects declared as `const` at `describe()`-body scope with a hardcoded literal tenant-id string (e.g. `const adminHeaders = { 'x-tenant-id': 'test_foo', ... }`), convert them to `let` and assign inside `beforeAll` using `ctx.tenantId` — the tenant id is only known once the async `setupTenantTestContext()` resolves. (Learned from Task 2, commit a431351: this is a mechanical consequence of moving to a dynamically-assigned tenant id, not a restructuring choice.)
10. For controller-style specs using `Test.createTestingModule(...).overrideProvider(DataSource).useValue(dataSource)`: replace `.useValue(dataSource)` with `.useValue(ctx.dataSource)`. If the file separately resolves `moduleRef.get(AccountsService)` or `moduleRef.get(TenantContextService)` solely for out-of-band fixture setup (not for wiring into the Nest DI graph, e.g. a middleware constructor argument), use `ctx.accountsService`/`ctx.tenantContext` for that fixture setup instead — same schema, same effect, keeps every file's out-of-band setup consistent. Keep DI-resolved instances only where genuinely needed for DI wiring.
11. If a file calls `tenantContext.run(...)` inline with tenant IDs other than its own single fixed tenant (e.g. ad-hoc probe/malicious-input tenant-id strings, or additional tenants not obtained via `ctx.createTenant()`), keep those as direct `ctx.tenantContext.run(...)` calls rather than `ctx.inTenant(...)` — `ctx.inTenant()` is only for work scoped to `ctx.tenantId` itself.

Per-file notes:

- `orders.controller.integration-spec.ts` — controller-style; no RBAC seeding.
- `orders.service.integration-spec.ts` — multi-tenant — replace its second tenant with `ctx.createTenant()`.
- `patient-entities.integration-spec.ts`, `patient-number-generator.service.integration-spec.ts`, `patients.service.integration-spec.ts` — single tenant, no RBAC seeding.
- `patients.controller.integration-spec.ts` — calls `seedRbacCatalog`; pass `seedRbac: true`.
- `seed-rbac-catalog.integration-spec.ts` — this file's subject under test is RBAC seeding itself; it already calls `seedRbacCatalog` directly as part of its assertions, not just setup. Read it carefully: only replace the schema-provisioning/teardown boilerplate with `TenantTestContext` (`seedRbac: false` in `setupTenantTestContext`, since seeding is the thing under test), and keep the direct `seedRbacCatalog(...)` calls inside the `it()` bodies as-is (via `ctx.dataSource`, since that's what they need).
- `persisting-reporting-event-publisher.integration-spec.ts` — this file was extensively hardened this session (dedicated `REPORTING_DATA_SOURCE` pool, pool-exhaustion test, audit-exclusion test, etc.) and boots `AppModule`. It's multi-tenant (`TEST_TENANT_ID_1`/`TEST_TENANT_ID_2`) via its own local `inTenant(tenantId, work)` taking an explicit `tenantId` param — different shape from the single-tenant convenience closure other files use. Migrate its schema provisioning/teardown onto `TenantTestContext` (`ctx` for tenant 1, `await ctx.createTenant()` for tenant 2), but **do not** change anything about the `REPORTING_DATA_SOURCE`/pool-exhaustion/audit-exclusion test logic itself — this file has already been through multiple review rounds this session; touch only the provisioning/teardown shape, nothing else. Run this file's tests individually before and after and diff the test names/count to confirm zero behavior change.

- [ ] **Step 2: Run the batch**

Run: `pnpm exec jest -c apps/api/jest.config.cts --rootDir apps/api orders patients seed-rbac-catalog persisting-reporting-event-publisher`
Expected: PASS, same test counts as before (reporting spec: still 9/9 per this session's prior work).

- [ ] **Step 3: Run the full suite**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS, same total test count as the very first run of this plan (Task 1, Step 4) — this task completes the migration, so this is the final full-suite check across the whole plan.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/orders/orders.controller.integration-spec.ts \
  apps/api/src/orders/orders.service.integration-spec.ts \
  apps/api/src/patients/patient-entities.integration-spec.ts \
  apps/api/src/patients/patient-number-generator.service.integration-spec.ts \
  apps/api/src/patients/patients.controller.integration-spec.ts \
  apps/api/src/patients/patients.service.integration-spec.ts \
  apps/api/src/rbac/seed-rbac-catalog.integration-spec.ts \
  apps/api/src/reporting/persisting-reporting-event-publisher.integration-spec.ts
git commit -m "refactor(testing): migrate orders/patients/rbac/reporting specs onto TenantTestContext"
```

---

### Task 8: Documentation

**Files:**
- Modify: `new/docs/technical-design/pending-tasks.md` (check off Phase 1 item 1)
- Create or modify: a `TESTING.md`-equivalent doc if one exists under `apps/api/` conventions, otherwise add this section directly to `new/docs/technical-design/Development-Standards.md` (check which already documents testing conventions — `Development-Standards.md:30` was flagged in `review-comments.md` as describing the old, nonexistent `inTenant()` helper, so that's the file to correct)

**Interfaces:**
- Consumes: nothing (docs only)

- [ ] **Step 1: Correct the stale `inTenant()` description**

Read `new/docs/technical-design/Development-Standards.md` around line 30 (the line `review-comments.md` flagged as describing a transaction-rollback-based `inTenant()` that never existed). Replace that description with the actual, now-real shared helper:

```markdown
### Tenant-scoped integration tests

Every integration spec provisions a real tenant schema and runs against it — there is no
transaction-rollback isolation anywhere in this codebase. Use the shared helper in
`apps/api/src/testing/tenant-test-context.ts`:

```ts
let ctx: TenantTestContext;

beforeAll(async () => {
  ctx = await setupTenantTestContext({ namePrefix: 'my-feature', seedRbac: true });
});

afterAll(() => teardownTenantTestContext(ctx));

it('...', async () => {
  await ctx.inTenant(() => ctx.someService.doSomething());
});
```

Tenant IDs are sequential and deterministic (`my-feature_1`, `my-feature_2`, ...) — never a
timestamp or random suffix. `setupTenantTestContext()` drops any same-named schema before
provisioning, so a schema left behind by a crashed prior run never collides with the next one.

For tests needing more than one tenant (e.g. isolation tests), call `await ctx.createTenant()` —
it shares the same connection and returns the next sequential tenant ID.

**Audit and reporting subscribers in tests:** both fire on any tracked entity insert regardless
of a test's isolation model, and write into the *same* tenant schema under test — audit via the
main connection pool, reporting via its own dedicated pool (see
`new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`). Both get cleaned up by the same
`teardownTenantTestContext()` call, since they're schema-scoped, not transaction-scoped.
```

- [ ] **Step 2: Check off Phase 1 item 1 in `pending-tasks.md`**

Change:
```markdown
1. **Shared `inTenant()` test helper** (new-features.md #5) — build *before* item 3. Proving
```
to:
```markdown
1. [x] **Shared `inTenant()` test helper** (new-features.md #5) — done: `apps/api/src/testing/tenant-test-context.ts`, all ~40 integration specs migrated. Build *before* item 3. Proving
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document TenantTestContext, check off Phase 1 item 1"
```
