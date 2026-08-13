# Platform (Super Admin) Console Above Tenants — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the platform/vendor operator ("Super Admin") a console above tenants — its account living in a reserved `__platform` tenant rather than inside a customer hospital, and its screens served by a separate shell and route tree that contain no tenant-scoped clinical or billing data.

**Architecture:** A reserved system tenant `__platform` holds Super Admin accounts, reusing the existing tenant/account/JWT machinery unchanged. The frontend splits into two shells over two route trees (`/platform/*` and the existing tenant routes), guarded by an `isPlatformAdmin` signal derived from the JWT's `hospitalId` claim. Data isolation is structural — a Super Admin's JWT names `__platform`, so tenant-scoped queries resolve against an empty platform schema rather than a hospital's — so no per-endpoint authorization code is added.

**Tech Stack:** Backend — NestJS 11, TypeORM, PostgreSQL schema-per-tenant, Jest (`@swc/jest`), Nx 23. Frontend — Angular 21.2, PrimeNG 21, Tailwind CSS v4, Angular signals, Jest via `jest-preset-angular`, Nx 23.

**Spec:** `new/docs/superpowers/specs/2026-08-13-platform-superadmin-console-design.md`

## Global Constraints

- **Two separate git repositories.** Backend tasks (1–2) commit in `new_hospital` (repo root); frontend tasks (3–8) commit in `new_hospital/frontend`, which is its own independent repo and is untracked from the root. Never stage frontend files from the root repo.
- **Pre-flight:** `frontend` currently has uncommitted table-header styling work (`.table-header-cell` in `styles.css` plus 11 `*.html` files). Commit or stash it before Task 3 so it does not get absorbed into this plan's commits.
- Reserved tenant id is exactly `PLATFORM_TENANT_ID = '__platform'` (schema `tenant___platform`).
- Platform admin seed credential defaults: username `superadmin`, password `SuperAdmin@123!`, email `superadmin@hospital.local`, display name `System Administrator`; env vars `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` / `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_DISPLAY_NAME`.
- Demo hospital admin seed defaults: username `demoadmin`, tenant `demo`, hospital name `Demo Hospital`, role `Hospital Admin`; env vars keep the existing `MASTER_ADMIN_*` names.
- Backend relative imports require explicit `.js` extensions (`nodenext` module resolution). `tsc --build` enforces this; Jest does not.
- Frontend `tsconfig*.json` files are protected by a `guard-config.sh` hook — no task in this plan needs to touch them. If one appears to, stop and ask.
- Angular commits: conventional-commit prefixes, never `--amend`, never an AI co-authorship trailer.
- Landing pages: platform → `/platform/dashboard`; tenant → `/billing/invoices` (the existing default).
- Local dev URLs after this plan: Super Admin at `http://admin.localhost:4200`, hospital users at `http://localhost:4200`.

---

## File Structure

**Backend (`new/code`)**

| File | Responsibility |
|---|---|
| `apps/api/src/tenants/platform-tenant.ts` *(create)* | Single source of truth for the reserved tenant id. |
| `apps/api/src/tenants/tenants.service.ts` *(modify)* | Exclude/refuse the platform tenant on list, get, provision, suspend. |
| `apps/api/src/tenants/tenants.controller.integration-spec.ts` *(modify)* | Integration coverage for the four refusals. |
| `apps/api/src/database/seed-initial-setup.ts` *(modify)* | Seed platform admin into `__platform`; seed demo hospital admin into `demo`. |
| `apps/api/src/database/seed-initial-setup.integration-spec.ts` *(create)* | Assert the seed produces the two-account split. |

**Frontend (`frontend`)**

| File | Responsibility |
|---|---|
| `libs/auth/src/lib/platform-tenant.ts` *(create)* | Frontend copy of the reserved tenant id. |
| `libs/auth/src/lib/auth.service.ts` *(modify)* | `isPlatformAdmin` computed signal. |
| `libs/auth/src/lib/auth.guard.ts` *(modify)* | `platformGuard`, `tenantGuard`. |
| `libs/auth/src/index.ts` *(modify)* | Export the new constant. |
| `apps/staff-console/src/app/shell/shell-chrome.ts` / `.html` *(create)* | Sidebar frame, header, menus, `<router-outlet>`; projects a nav slot. |
| `apps/staff-console/src/app/shell/app-shell.ts` / `.html` *(modify)* | Thin wrapper supplying the tenant nav. |
| `apps/staff-console/src/app/shell/platform-shell.ts` / `.html` *(create)* | Thin wrapper supplying the platform nav. |
| `apps/staff-console/src/app/app.routes.ts` *(modify)* | Two guarded trees + audience-aware root redirect. |
| `apps/staff-console/src/app/app.config.ts` *(modify)* | `admin` subdomain → `__platform`. |
| `apps/staff-console/src/app/login/login.ts` *(modify)* | Audience-aware post-login redirect. |

**Docs (`new_hospital`)** — `new/docs/technical-design/Development-Standards.md`, `pending-tasks.md`, `mvp-status.md`.

---

### Task 1: Reserve the `__platform` tenant in TenantsService

**Repo:** `new_hospital` — run commands from `new/code`.

**Files:**
- Create: `apps/api/src/tenants/platform-tenant.ts`
- Modify: `apps/api/src/tenants/tenants.service.ts:1-11, 30-39, 100-120`
- Test: `apps/api/src/tenants/tenants.controller.integration-spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `PLATFORM_TENANT_ID: string` exported from `apps/api/src/tenants/platform-tenant.ts`. Task 2 imports it.

- [ ] **Step 1: Write the failing tests**

Append these four cases inside the existing `describe('TenantsController (integration)')` block in `apps/api/src/tenants/tenants.controller.integration-spec.ts`, and add the import at the top of the file:

```typescript
import { PLATFORM_TENANT_ID } from './platform-tenant.js';
```

```typescript
  it('rejects provisioning the reserved platform tenant id with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ hospitalId: PLATFORM_TENANT_ID, hospitalName: 'Should Not Exist' });

    expect(response.status).toBe(400);
  });

  it('omits the reserved platform tenant from the tenant list', async () => {
    await ctx.dataSource.query(
      `INSERT INTO tenants ("hospitalId", "hospitalName", status, "createdBy")
       VALUES ($1, 'Platform', 'active', 'test')
       ON CONFLICT ("hospitalId") DO NOTHING`,
      [PLATFORM_TENANT_ID],
    );

    const response = await request(app.getHttpServer())
      .get('/tenants')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const ids = response.body.map((t: { hospitalId: string }) => t.hospitalId);
    expect(ids).not.toContain(PLATFORM_TENANT_ID);
  });

  it('returns 404 for a direct fetch of the reserved platform tenant', async () => {
    const response = await request(app.getHttpServer())
      .get(`/tenants/${PLATFORM_TENANT_ID}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('refuses to suspend the reserved platform tenant with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/tenants/${PLATFORM_TENANT_ID}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
```

Add cleanup for the inserted row to the existing `afterAll`, immediately before the `DELETE FROM tenants WHERE "hospitalId" LIKE 'test_tenant_ctrl_%'` line:

```typescript
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" = $1`, [PLATFORM_TENANT_ID]);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPattern=tenants.controller`
Expected: FAIL — `Cannot find module './platform-tenant.js'`.

- [ ] **Step 3: Create the constant**

Create `apps/api/src/tenants/platform-tenant.ts`:

```typescript
/**
 * Reserved system tenant that platform ("Super Admin") accounts live in.
 *
 * It is not a hospital: it is never returned by tenant listings or direct fetches, never
 * provisionable through the API, and never suspendable. Platform operators live here so that
 * suspending or deleting any real hospital cannot orphan the account that administers the platform.
 */
export const PLATFORM_TENANT_ID = '__platform';
```

- [ ] **Step 4: Enforce the reservation in TenantsService**

In `apps/api/src/tenants/tenants.service.ts`, add `Not` to the existing `typeorm` import and import the constant:

```typescript
import { DataSource, Not } from 'typeorm';
import { PLATFORM_TENANT_ID } from './platform-tenant.js';
```

In `provisionTenant`, immediately after the existing `SAFE_HOSPITAL_ID` check (currently lines 31-33):

```typescript
    if (input.hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot be provisioned`,
      );
    }
```

Replace `listTenants` and `getTenant` (currently lines 100-106):

```typescript
  async listTenants(): Promise<Tenant[]> {
    // The platform tenant is not a hospital — it must never surface in a customer listing.
    return this.dataSource.getRepository(Tenant).find({
      where: { hospitalId: Not(PLATFORM_TENANT_ID) },
      order: { createdAt: 'ASC' },
    });
  }

  async getTenant(hospitalId: string): Promise<Tenant | null> {
    if (hospitalId === PLATFORM_TENANT_ID) {
      return null;
    }
    return this.dataSource.getRepository(Tenant).findOne({ where: { hospitalId } });
  }
```

Add the refusal as the first statement in `suspendTenant` (currently line 109):

```typescript
    if (hospitalId === PLATFORM_TENANT_ID) {
      throw new BadRequestException(
        `${PLATFORM_TENANT_ID} is a reserved system tenant and cannot be suspended`,
      );
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPattern=tenants.controller`
Expected: PASS, including the four pre-existing provisioning/duplicate cases.

- [ ] **Step 6: Typecheck**

Run: `pnpm exec nx run-many -t typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/tenants/platform-tenant.ts apps/api/src/tenants/tenants.service.ts apps/api/src/tenants/tenants.controller.integration-spec.ts
git commit -m "feat: reserve __platform as a non-provisionable system tenant"
```

---

### Task 2: Split the seed into a platform admin and a demo hospital admin

**Repo:** `new_hospital` — run commands from `new/code`.

**Files:**
- Modify: `apps/api/src/database/seed-initial-setup.ts:11-32, 71-129, 220-240`
- Test: `apps/api/src/database/seed-initial-setup.integration-spec.ts` *(create)*

**Interfaces:**
- Consumes: `PLATFORM_TENANT_ID` from `apps/api/src/tenants/platform-tenant.js` (Task 1).
- Produces: `seedPlatformAdmin(dataSource: DataSource): Promise<void>` and `seedDemoHospitalAdmin(dataSource: DataSource): Promise<void>`, both exported from `apps/api/src/database/seed-initial-setup.js`. `seedMasterAdmin` is removed; `runInitialSetup(dataSource: DataSource): Promise<void>` keeps its signature and calls both.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/database/seed-initial-setup.integration-spec.ts`:

```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { AccountsService } from '../accounts/accounts.service.js';
import { TenantConnectionService } from './tenant-connection.service.js';
import { seedPlatformAdmin, seedDemoHospitalAdmin } from './seed-initial-setup.js';
import {
  setupTenantTestContext,
  teardownTenantTestContext,
  TenantTestContext,
} from '../testing/tenant-test-context.js';

// These specs run against the SAME database as local dev. Both seeded tenants are therefore
// redirected to test_-scoped ids via env overrides, and teardown drops only those — the real
// __platform schema and its Super Admin must survive a test run untouched.
const TEST_PLATFORM_TENANT = 'test_seed_split_platform';
const TEST_DEMO_TENANT = 'test_seed_split_demo';

describe('seed-initial-setup (integration)', () => {
  let ctx: TenantTestContext;

  beforeAll(async () => {
    ctx = await setupTenantTestContext({ namePrefix: 'seed_split', seedRbac: true });
    process.env['PLATFORM_ADMIN_TENANT_ID'] = TEST_PLATFORM_TENANT;
    process.env['MASTER_ADMIN_TENANT_ID'] = TEST_DEMO_TENANT;
    await seedPlatformAdmin(ctx.dataSource);
    await seedDemoHospitalAdmin(ctx.dataSource);
  });

  afterAll(async () => {
    delete process.env['PLATFORM_ADMIN_TENANT_ID'];
    delete process.env['MASTER_ADMIN_TENANT_ID'];
    for (const id of [TEST_PLATFORM_TENANT, TEST_DEMO_TENANT]) {
      await ctx.dataSource.query(`DROP SCHEMA IF EXISTS "tenant_${id}" CASCADE`);
      await ctx.dataSource.query(`DROP ROLE IF EXISTS "tenant_${id}"`);
    }
    await ctx.dataSource.query(`DELETE FROM tenants WHERE "hospitalId" IN ($1, $2)`, [
      TEST_PLATFORM_TENANT,
      TEST_DEMO_TENANT,
    ]);
    await teardownTenantTestContext(ctx);
  });

  function accountsIn(tenantId: string) {
    const tenantContext = new TenantContextService();
    const accountsService = new AccountsService(
      new TenantConnectionService(ctx.dataSource, tenantContext),
      ctx.dataSource,
      tenantContext,
    );
    return {
      find: (username: string) =>
        tenantContext.run({ tenantId, correlationId: 'seed-split-spec' }, () =>
          accountsService.findByUsernameWithRoles(username),
        ),
    };
  }

  it('creates the superadmin account inside the platform tenant with the Super Admin role', async () => {
    const account = await accountsIn(TEST_PLATFORM_TENANT).find('superadmin');

    expect(account).not.toBeNull();
    expect(account?.roles.map((r) => r.name)).toContain('Super Admin');
  });

  it('does not create a Super Admin inside the demo hospital tenant', async () => {
    const account = await accountsIn(TEST_DEMO_TENANT).find('superadmin');

    expect(account).toBeNull();
  });

  it('creates the demo hospital administrator with the Hospital Admin role', async () => {
    const account = await accountsIn(TEST_DEMO_TENANT).find('demoadmin');

    expect(account).not.toBeNull();
    expect(account?.roles.map((r) => r.name)).toContain('Hospital Admin');
  });

  // The platform/tenant data boundary is structural: scope comes from the JWT's tenant, so a
  // hospital user's queries never reach the platform schema. Asserted here against the new tenant
  // because this is the seam the whole design leans on.
  it('does not expose the platform admin account to a hospital tenant lookup', async () => {
    const fromDemo = await accountsIn(TEST_DEMO_TENANT).find('superadmin');
    const fromPlatform = await accountsIn(TEST_PLATFORM_TENANT).find('superadmin');

    expect(fromDemo).toBeNull();
    expect(fromPlatform).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec nx test api --testPathPattern=seed-initial-setup`
Expected: FAIL — `seed-initial-setup.js` exports neither `seedPlatformAdmin` nor `seedDemoHospitalAdmin`.

- [ ] **Step 3: Rewrite the seed's config and account functions**

In `apps/api/src/database/seed-initial-setup.ts`, add the import beneath the existing ones:

```typescript
import { PLATFORM_TENANT_ID } from '../tenants/platform-tenant.js';
```

Replace the `MasterAdminConfig` interface and `getMasterAdminConfig` (currently lines 11-32) with a shared shape plus two configs:

```typescript
interface SeededAdminConfig {
  tenantId: string;
  hospitalName: string;
  username: string;
  email: string;
  password: string;
  displayName: string;
  roleName: string;
}

/** The platform operator. Lives in the reserved system tenant, never inside a customer hospital. */
function getPlatformAdminConfig(): SeededAdminConfig {
  return {
    // Overridable ONLY so integration tests can seed into a test-scoped tenant: specs run against
    // the same database as local dev, so a test must never touch the real __platform schema.
    // Tenant reservation in TenantsService keys off the PLATFORM_TENANT_ID constant, never this
    // variable, so overriding it cannot un-reserve the real id.
    tenantId: process.env['PLATFORM_ADMIN_TENANT_ID'] ?? PLATFORM_TENANT_ID,
    hospitalName: 'Platform Administration',
    username: process.env['PLATFORM_ADMIN_USERNAME'] ?? 'superadmin',
    email: process.env['PLATFORM_ADMIN_EMAIL'] ?? 'superadmin@hospital.local',
    password: process.env['PLATFORM_ADMIN_PASSWORD'] ?? 'SuperAdmin@123!',
    displayName: process.env['PLATFORM_ADMIN_DISPLAY_NAME'] ?? 'System Administrator',
    roleName: 'Super Admin',
  };
}

/** The demo hospital's own administrator — a tenant user, deliberately NOT a Super Admin. */
function getDemoHospitalAdminConfig(): SeededAdminConfig {
  return {
    tenantId: process.env['MASTER_ADMIN_TENANT_ID'] ?? 'demo',
    hospitalName: process.env['MASTER_ADMIN_TENANT_NAME'] ?? 'Demo Hospital',
    username: process.env['MASTER_ADMIN_USERNAME'] ?? 'demoadmin',
    email: process.env['MASTER_ADMIN_EMAIL'] ?? 'demoadmin@hospital.local',
    password: process.env['MASTER_ADMIN_PASSWORD'] ?? 'DemoAdmin@123!',
    displayName: process.env['MASTER_ADMIN_DISPLAY_NAME'] ?? 'Demo Hospital Administrator',
    roleName: 'Hospital Admin',
  };
}
```

Rename `ensureMasterAdminTenant` to `ensureSeededTenant` and widen its parameter type — replace its signature and the error message (currently lines 34-42) with:

```typescript
async function ensureSeededTenant(
  dataSource: DataSource,
  config: SeededAdminConfig,
): Promise<void> {
  if (!SAFE_TENANT_ID.test(config.tenantId)) {
    throw new Error(
      `Seed tenant id must match /^[a-z0-9_]+$/ (got: ${config.tenantId})`,
    );
  }
```

The rest of that function's body is unchanged.

- [ ] **Step 4: Replace `seedMasterAdmin` with the two seeders**

Replace the whole `seedMasterAdmin` function (currently lines 71-129) with:

```typescript
async function seedAdminAccount(
  dataSource: DataSource,
  config: SeededAdminConfig,
): Promise<void> {
  const role = await dataSource
    .getRepository(Role)
    .findOne({ where: { name: config.roleName } });

  if (!role) {
    console.warn(
      `${config.roleName} role not found. Please run RBAC catalog seeding first.`,
    );
    return;
  }

  await ensureSeededTenant(dataSource, config);

  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(
    tenantConnection,
    dataSource,
    tenantContext,
  );

  const existing = await tenantContext.run(
    { tenantId: config.tenantId, correlationId: 'seed-initial-setup' },
    () => accountsService.findByUsernameWithRoles(config.username),
  );

  if (existing) {
    console.log(
      `Account '${config.username}' already exists in tenant '${config.tenantId}'. Skipping creation.`,
    );
    return;
  }

  await tenantContext.run(
    { tenantId: config.tenantId, correlationId: 'seed-initial-setup' },
    () =>
      accountsService.createStaffAccount({
        username: config.username,
        email: config.email,
        displayName: config.displayName,
        password: config.password,
        roleName: role.name,
        needsPasswordUpdate: false,
      }),
  );
  console.log(
    `✓ Created ${config.roleName}: ${config.username} (tenant: ${config.tenantId})`,
  );
}

export async function seedPlatformAdmin(dataSource: DataSource): Promise<void> {
  await seedAdminAccount(dataSource, getPlatformAdminConfig());
}

export async function seedDemoHospitalAdmin(dataSource: DataSource): Promise<void> {
  await seedAdminAccount(dataSource, getDemoHospitalAdminConfig());
}
```

- [ ] **Step 5: Update the setup runner and its credential banner**

Replace `runInitialSetup` (currently lines 220-240) with:

```typescript
export async function runInitialSetup(dataSource: DataSource): Promise<void> {
  console.log('Starting initial system setup...\n');

  await seedInitialRolesAndPermissions(dataSource);
  console.log('');
  await seedPlatformAdmin(dataSource);
  await seedDemoHospitalAdmin(dataSource);

  const platform = getPlatformAdminConfig();
  const demo = getDemoHospitalAdminConfig();

  console.log('\n✓ Initial setup completed successfully!');
  console.log('\n--- Platform Administrator (http://admin.localhost:4200) ---');
  console.log(`Tenant: ${platform.tenantId}`);
  console.log(`Username: ${platform.username}`);
  console.log(`Password: ${platform.password}`);
  console.log('\n--- Demo Hospital Administrator (http://localhost:4200) ---');
  console.log(`Tenant: ${demo.tenantId}`);
  console.log(`Username: ${demo.username}`);
  console.log(`Password: ${demo.password}`);
  console.log('-------------------------\n');
  console.log(
    '⚠️  IMPORTANT: Change the default passwords immediately after first login!\n',
  );
}
```

- [ ] **Step 6: Fix any remaining reference to the removed export**

Run: `grep -rn "seedMasterAdmin" apps/api/src`
Expected: no matches. If `seed-initial-setup-runner.ts` references it, repoint it to `runInitialSetup`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec nx test api --testPathPattern=seed-initial-setup`
Expected: PASS — all three cases.

- [ ] **Step 8: Run the full backend suite and typecheck**

Run: `pnpm exec nx run-many -t typecheck test`
Expected: PASS with 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/database/seed-initial-setup.ts apps/api/src/database/seed-initial-setup.integration-spec.ts
git commit -m "feat: seed platform admin into __platform, demo admin into demo tenant"
```

---

### Task 3: `isPlatformAdmin` in `@org/auth`

**Repo:** `frontend`. **Pre-flight:** commit or stash the uncommitted table-header styling work first.

**Files:**
- Create: `libs/auth/src/lib/platform-tenant.ts`
- Modify: `libs/auth/src/lib/auth.service.ts:24-25`, `libs/auth/src/index.ts`
- Test: `libs/auth/src/lib/auth.service.spec.ts`

**Interfaces:**
- Consumes: `AccessTokenClaims.hospitalId` (already exists).
- Produces: `PLATFORM_TENANT_ID: string` from `@org/auth`, and `AuthService.isPlatformAdmin: Signal<boolean>`. Tasks 4, 6, 7, 8 consume both.

- [ ] **Step 1: Write the failing test**

Append to `libs/auth/src/lib/auth.service.spec.ts`, inside the existing top-level `describe`:

```typescript
  describe('isPlatformAdmin', () => {
    it('is true when the token claims the platform tenant', () => {
      const service = TestBed.inject(AuthService);
      service.setSession(
        signClaims({ hospitalId: '__platform', permissions: [] }),
        'refresh-token',
      );

      expect(service.isPlatformAdmin()).toBe(true);
    });

    it('is false when the token claims a hospital tenant', () => {
      const service = TestBed.inject(AuthService);
      service.setSession(
        signClaims({ hospitalId: 'demo', permissions: [] }),
        'refresh-token',
      );

      expect(service.isPlatformAdmin()).toBe(false);
    });

    it('is false when unauthenticated', () => {
      const service = TestBed.inject(AuthService);

      expect(service.isPlatformAdmin()).toBe(false);
    });
  });
```

Reuse the file's existing TestBed setup and token-building helper. If the existing spec builds tokens inline rather than through a `signClaims` helper, add one at the top of the file matching the shape already used there:

```typescript
  function signClaims(overrides: Partial<AccessTokenClaims>): string {
    const claims: AccessTokenClaims = {
      sub: 'test-user',
      hospitalId: 'demo',
      roles: [],
      permissions: [],
      type: 'access',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    };
    const encode = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
    return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
  }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx test auth --testPathPattern=auth.service`
Expected: FAIL — `service.isPlatformAdmin is not a function`.

- [ ] **Step 3: Create the constant**

Create `libs/auth/src/lib/platform-tenant.ts`:

```typescript
/**
 * Reserved system tenant that platform ("Super Admin") accounts live in.
 * Must stay in sync with the backend's apps/api/src/tenants/platform-tenant.ts.
 */
export const PLATFORM_TENANT_ID = '__platform';
```

- [ ] **Step 4: Add the computed signal**

In `libs/auth/src/lib/auth.service.ts`, add the import:

```typescript
import { PLATFORM_TENANT_ID } from './platform-tenant.js';
```

and add the signal immediately after `currentUser` (currently line 25):

```typescript
  /**
   * Derived from the JWT's hospitalId claim rather than a role name: the backend issues the claim,
   * so a tenant-resident user cannot forge it, and it stays correct if roles are ever renamed.
   */
  readonly isPlatformAdmin = computed(
    () => this.claims()?.hospitalId === PLATFORM_TENANT_ID,
  );
```

- [ ] **Step 5: Export the constant**

In `libs/auth/src/index.ts`, add:

```typescript
export * from './lib/platform-tenant.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm nx test auth --testPathPattern=auth.service`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/auth/src/lib/platform-tenant.ts libs/auth/src/lib/auth.service.ts libs/auth/src/lib/auth.service.spec.ts libs/auth/src/index.ts
git commit -m "feat: derive isPlatformAdmin from the JWT hospitalId claim"
```

---

### Task 4: `platformGuard` and `tenantGuard`

**Repo:** `frontend`.

**Files:**
- Modify: `libs/auth/src/lib/auth.guard.ts`
- Test: `libs/auth/src/lib/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `AuthService.isAuthenticated`, `AuthService.isPlatformAdmin` (Task 3).
- Produces: `platformGuard: CanActivateFn` and `tenantGuard: CanActivateFn`, both exported from `@org/auth`. Task 7 attaches them to the two route trees.

- [ ] **Step 1: Write the failing tests**

Append to `libs/auth/src/lib/auth.guard.spec.ts`:

```typescript
describe('platformGuard / tenantGuard', () => {
  function setup(isAuthenticated: boolean, isPlatformAdmin: boolean) {
    const authService = {
      isAuthenticated: () => isAuthenticated,
      isPlatformAdmin: () => isPlatformAdmin,
    } as unknown as AuthService;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    });
  }

  it('platformGuard allows a platform admin', () => {
    setup(true, true);
    const result = TestBed.runInInjectionContext(() =>
      platformGuard({} as never, { url: '/platform/tenants' } as never),
    );
    expect(result).toBe(true);
  });

  it('platformGuard sends a tenant user to the tenant landing page', () => {
    setup(true, false);
    const result = TestBed.runInInjectionContext(() =>
      platformGuard({} as never, { url: '/platform/tenants' } as never),
    );
    expect(result?.toString()).toBe('/billing/invoices');
  });

  it('platformGuard sends an unauthenticated visitor to /login', () => {
    setup(false, false);
    const result = TestBed.runInInjectionContext(() =>
      platformGuard({} as never, { url: '/platform/tenants' } as never),
    );
    expect(result?.toString()).toBe('/login');
  });

  it('tenantGuard allows a tenant user', () => {
    setup(true, false);
    const result = TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/clinical/patients' } as never),
    );
    expect(result).toBe(true);
  });

  it('tenantGuard sends a platform admin to the platform landing page', () => {
    setup(true, true);
    const result = TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/clinical/patients' } as never),
    );
    expect(result?.toString()).toBe('/platform/dashboard');
  });

  it('tenantGuard sends an unauthenticated visitor to /login', () => {
    setup(false, false);
    const result = TestBed.runInInjectionContext(() =>
      tenantGuard({} as never, { url: '/clinical/patients' } as never),
    );
    expect(result?.toString()).toBe('/login');
  });
});
```

Update the file's first import line to pull in the new guards:

```typescript
import { authGuard, permissionGuard, platformGuard, tenantGuard } from './auth.guard.js';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test auth --testPathPattern=auth.guard`
Expected: FAIL — `platformGuard` is not exported.

- [ ] **Step 3: Implement the guards**

Append to `libs/auth/src/lib/auth.guard.ts`:

```typescript
export const PLATFORM_LANDING_URL = '/platform/dashboard';
export const TENANT_LANDING_URL = '/billing/invoices';

/**
 * Keeps each audience inside its own route tree. The wrong audience is redirected to the other
 * tree's landing page rather than to /login — a mis-typed URL is not a session failure, and
 * bouncing a signed-in user to a login form reads as one.
 */
export const platformGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  return authService.isPlatformAdmin() ? true : router.createUrlTree([TENANT_LANDING_URL]);
};

export const tenantGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  return authService.isPlatformAdmin() ? router.createUrlTree([PLATFORM_LANDING_URL]) : true;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test auth --testPathPattern=auth.guard`
Expected: PASS — all six new cases plus the two pre-existing `authGuard` cases.

- [ ] **Step 5: Commit**

```bash
git add libs/auth/src/lib/auth.guard.ts libs/auth/src/lib/auth.guard.spec.ts
git commit -m "feat: add platformGuard and tenantGuard route guards"
```

---

### Task 5: Extract `ShellChrome` from `AppShell`

Both consoles share identical chrome — sidebar frame, breadcrumb header, search, notifications, quick actions, user menu, logout, `<router-outlet>`. Extracting it once means Task 6's platform shell supplies only nav links instead of duplicating ~240 lines of markup and five menu-toggle methods.

**Repo:** `frontend`.

**Files:**
- Create: `apps/staff-console/src/app/shell/shell-chrome.ts`, `apps/staff-console/src/app/shell/shell-chrome.html`
- Modify: `apps/staff-console/src/app/shell/app-shell.ts`, `apps/staff-console/src/app/shell/app-shell.html`

**Interfaces:**
- Consumes: `AuthService` from `@org/auth`.
- Produces: `ShellChrome` component, selector `hms-shell-chrome`, projecting nav links via `<ng-content select="[shellNav]">`. Task 6's `PlatformShell` and this task's `AppShell` both wrap it.

- [ ] **Step 1: Create the chrome component class**

Create `apps/staff-console/src/app/shell/shell-chrome.ts` with the exact body of the current `app-shell.ts`, renamed:

```typescript
import { Component, inject, signal, computed } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '@org/auth';
import { TooltipModule } from 'primeng/tooltip';

interface Breadcrumb {
  label: string;
  link: string;
}

/**
 * Chrome shared by both consoles: sidebar frame, header, menus, and the router outlet.
 * Nav links are projected in by the wrapping shell (AppShell / PlatformShell) via [shellNav].
 */
@Component({
  imports: [RouterModule, TooltipModule],
  selector: 'hms-shell-chrome',
  templateUrl: './shell-chrome.html',
})
export class ShellChrome {
  readonly auth = inject(AuthService);

  readonly userMenuOpen = signal(false);
  readonly notificationsOpen = signal(false);
  readonly quickActionsOpen = signal(false);
  readonly searchFocused = signal(false);

  readonly unreadCount = signal(3);
  readonly breadcrumbs = signal<Breadcrumb[]>([]);

  readonly userInitials = computed(() => {
    const user = this.currentUser();
    const label = user?.roles[0];
    if (!label) return 'AU';
    return label.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  });

  logout(): void {
    this.auth.logout().subscribe();
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
    this.notificationsOpen.set(false);
    this.quickActionsOpen.set(false);
  }

  toggleNotifications(): void {
    this.notificationsOpen.update((open) => !open);
    this.userMenuOpen.set(false);
    this.quickActionsOpen.set(false);
  }

  toggleQuickActions(): void {
    this.quickActionsOpen.update((open) => !open);
    this.userMenuOpen.set(false);
    this.notificationsOpen.set(false);
  }

  currentUser() {
    return this.auth.currentUser();
  }

  closeMenus(): void {
    this.userMenuOpen.set(false);
    this.notificationsOpen.set(false);
    this.quickActionsOpen.set(false);
  }
}
```

- [ ] **Step 2: Move the chrome markup**

```bash
git mv apps/staff-console/src/app/shell/app-shell.html apps/staff-console/src/app/shell/shell-chrome.html
```

In `shell-chrome.html`, replace the entire contents of the `<nav class="flex flex-col gap-2">` element (currently lines 12-132 — every `@if` block and `<a>` between `<nav ...>` and `</nav>`) with a single projection slot, leaving the `<nav>` tags themselves in place:

```html
    <nav class="flex flex-col gap-2">
      <ng-content select="[shellNav]"></ng-content>
    </nav>
```

Everything else in the file — the sidebar wrapper, logo, logout button, header, search, menus, and `<main><router-outlet></router-outlet></main>` — is unchanged.

- [ ] **Step 3: Reduce `AppShell` to a nav supplier**

Replace `apps/staff-console/src/app/shell/app-shell.ts` entirely:

```typescript
import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { AuthService } from '@org/auth';
import { ShellChrome } from './shell-chrome.js';

/** Tenant console shell: hospital staff navigation over the shared chrome. */
@Component({
  imports: [RouterModule, ShellChrome],
  selector: 'hms-app-shell',
  templateUrl: './app-shell.html',
})
export class AppShell {
  readonly auth = inject(AuthService);
}
```

- [ ] **Step 4: Create the tenant nav template**

Create `apps/staff-console/src/app/shell/app-shell.html`. This is the tenant half of the old nav, with the Tenants and Global Catalog entries dropped and the `!hasPermission('system-admin.tenants.manage')` clause removed from the Invoices entry — that clause existed only to hide a tenant screen from a Super Admin, which routing now handles:

```html
<hms-shell-chrome>
  <ng-container shellNav>
    @if (auth.hasPermission('billing.manage')) {
    <a
      routerLink="/billing/invoices"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-receipt text-base"></i>
      Invoices
    </a>
    }
    @if (auth.hasPermission('patients.read') || auth.hasPermission('appointment.read') ||
    auth.hasPermission('triage.read')) {
    <div class="mt-4 mb-2 px-4 text-xs font-semibold tracking-wider text-slate-400 uppercase">
      Clinical
    </div>
    @if (auth.hasPermission('patients.read')) {
    <a
      routerLink="/clinical/patients"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-user text-base"></i>
      Patients (PMI)
    </a>
    } @if (auth.hasPermission('appointment.read')) {
    <a
      routerLink="/clinical/appointments"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-calendar text-base"></i>
      Appointments
    </a>
    } @if (auth.hasPermission('triage.read')) {
    <a
      routerLink="/clinical/triage"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-heart text-base"></i>
      Triage / ER
    </a>
    }
    }
    @if (auth.hasPermission('identity.accounts.manage') ||
    auth.hasPermission('master-data.manage') || auth.hasPermission('reporting.read')) {
    <div class="mt-4 mb-2 px-4 text-xs font-semibold tracking-wider text-slate-400 uppercase">
      Administration
    </div>
    @if (auth.hasPermission('identity.accounts.manage')) {
    <a
      routerLink="/admin/users"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-users text-base"></i>
      Staff Accounts
    </a>
    } @if (auth.hasPermission('master-data.manage')) {
    <a
      routerLink="/admin/master-data"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-database text-base"></i>
      Master Data
    </a>
    <a
      routerLink="/admin/billing-settings"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-cog text-base"></i>
      Billing Settings
    </a>
    } @if (auth.hasPermission('reporting.read')) {
    <a
      routerLink="/admin/audit"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-history text-base"></i>
      Audit Trail
    </a>
    } }
  </ng-container>
</hms-shell-chrome>
```

- [ ] **Step 5: Verify the app still builds and renders the tenant shell**

Run: `pnpm nx run staff-console:build`
Expected: PASS — "Application bundle generation complete".

- [ ] **Step 6: Commit**

```bash
git add apps/staff-console/src/app/shell/
git commit -m "refactor: extract ShellChrome so both consoles share one chrome"
```

---

### Task 6: `PlatformShell` with platform navigation

**Repo:** `frontend`.

**Files:**
- Create: `apps/staff-console/src/app/shell/platform-shell.ts`, `apps/staff-console/src/app/shell/platform-shell.html`

**Interfaces:**
- Consumes: `ShellChrome` (Task 5).
- Produces: `PlatformShell` component, selector `hms-platform-shell`. Task 7 mounts it as the `/platform/*` tree's shell.

- [ ] **Step 1: Create the component class**

Create `apps/staff-console/src/app/shell/platform-shell.ts`:

```typescript
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ShellChrome } from './shell-chrome.js';

/**
 * Platform console shell. Its nav is unconditional: reaching this shell at all requires
 * platformGuard, and a Super Admin holds every permission, so per-entry permission checks
 * would be noise.
 */
@Component({
  imports: [RouterModule, ShellChrome],
  selector: 'hms-platform-shell',
  templateUrl: './platform-shell.html',
})
export class PlatformShell {}
```

- [ ] **Step 2: Create the platform nav template**

Create `apps/staff-console/src/app/shell/platform-shell.html`:

```html
<hms-shell-chrome>
  <ng-container shellNav>
    <a
      routerLink="/platform/dashboard"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-chart-line text-base"></i>
      Dashboard
    </a>
    <a
      routerLink="/platform/tenants"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-building text-base"></i>
      Tenants
    </a>
    <a
      routerLink="/platform/catalog"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-globe text-base"></i>
      Global Catalog
    </a>
    <div class="mt-4 mb-2 px-4 text-xs font-semibold tracking-wider text-slate-400 uppercase">
      Platform
    </div>
    <a
      routerLink="/platform/admins"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-users text-base"></i>
      Platform Admins
    </a>
    <a
      routerLink="/platform/audit"
      routerLinkActive="gradient-bg text-white font-semibold"
      [routerLinkActiveOptions]="{ exact: false }"
      class="flex items-center gap-3 rounded-full px-4 py-3 text-sm text-slate-600 hover:bg-white/80 transition-colors duration-200"
    >
      <i class="pi pi-history text-base"></i>
      Platform Audit
    </a>
  </ng-container>
</hms-shell-chrome>
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm nx run staff-console:build`
Expected: PASS. (`PlatformShell` is not routed yet — Task 7 mounts it.)

- [ ] **Step 4: Commit**

```bash
git add apps/staff-console/src/app/shell/platform-shell.ts apps/staff-console/src/app/shell/platform-shell.html
git commit -m "feat: add PlatformShell with platform-only navigation"
```

---

### Task 7: Split the route tree

**Repo:** `frontend`.

**Files:**
- Modify: `apps/staff-console/src/app/app.routes.ts` (whole file)

**Interfaces:**
- Consumes: `platformGuard`, `tenantGuard` (Task 4); `PlatformShell` (Task 6); `AppShell` (Task 5). The `rootRedirectGuard` created in this task consumes `PLATFORM_LANDING_URL` / `TENANT_LANDING_URL` (Task 4).
- Produces: the `/platform/*` URLs the platform nav links to, and the `/billing/invoices` tenant landing Task 8 redirects to.

- [ ] **Step 1: Replace the route file**

Replace `apps/staff-console/src/app/app.routes.ts` entirely:

```typescript
import { Route } from '@angular/router';
import { authGuard, permissionGuard, platformGuard, tenantGuard, Permissions } from '@org/auth';
import { AppShell } from './shell/app-shell.js';
import { PlatformShell } from './shell/platform-shell.js';
import { Login } from './login/login.js';
import { rootRedirectGuard } from './root-redirect.guard.js';

export const appRoutes: Route[] = [
  // Bare '' cannot redirect to a fixed URL: the two audiences have different landing pages, and
  // a fixed target would bounce every user of the other audience off a guard.
  { path: '', pathMatch: 'full', canActivate: [rootRedirectGuard], children: [] },
  { path: 'login', component: Login },
  {
    path: '',
    component: PlatformShell,
    canActivate: [platformGuard],
    runGuardsAndResolvers: 'always',
    children: [
      {
        path: 'platform/dashboard',
        loadComponent: () => import('./admin-dashboard/admin-dashboard.js').then((m) => m.AdminDashboard),
      },
      {
        path: 'platform/tenants',
        loadComponent: () => import('./tenants/tenant-list/tenant-list.js').then((m) => m.TenantList),
      },
      {
        path: 'platform/tenants/:id',
        loadComponent: () => import('./tenants/tenant-detail/tenant-detail.js').then((m) => m.TenantDetail),
      },
      {
        path: 'platform/catalog',
        loadComponent: () => import('./global-catalog/global-catalog-list.js').then((m) => m.GlobalCatalogList),
      },
      // Same components as the tenant tree's /admin/users and /admin/audit: both are scoped by the
      // JWT's tenant, so under a platform admin they resolve to platform admins and the platform
      // audit trail with no parameterization.
      {
        path: 'platform/admins',
        loadComponent: () => import('./users/user-list.js').then((m) => m.UserList),
      },
      {
        path: 'platform/admins/:id',
        loadComponent: () => import('./users/user-detail.js').then((m) => m.UserDetail),
      },
      {
        path: 'platform/audit',
        loadComponent: () => import('./audit/audit-list.js').then((m) => m.AuditList),
      },
    ],
  },
  {
    path: '',
    component: AppShell,
    canActivate: [authGuard, tenantGuard],
    // Angular reuses this parent route node across sibling-to-sibling navigation within the
    // shell and, by default, skips re-running canActivate when the node itself is reused —
    // 'always' forces the guards to actually run on every navigation, not just first entry.
    runGuardsAndResolvers: 'always',
    children: [
      {
        path: 'billing/invoices',
        loadComponent: () => import('./billing/invoice-list/invoice-list.js').then((m) => m.InvoiceList),
        canActivate: [permissionGuard(Permissions.BILLING_MANAGE)],
      },
      {
        path: 'billing/invoices/:id',
        loadComponent: () => import('./billing/invoice-detail/invoice-detail.js').then((m) => m.InvoiceDetail),
        canActivate: [permissionGuard(Permissions.BILLING_MANAGE)],
      },
      {
        path: 'admin/billing-settings',
        loadComponent: () => import('./billing/billing-settings/billing-settings.js').then((m) => m.BillingSettingsComponent),
        canActivate: [permissionGuard(Permissions.MASTER_DATA_MANAGE)],
      },
      {
        path: 'admin/users',
        loadComponent: () => import('./users/user-list.js').then((m) => m.UserList),
        canActivate: [permissionGuard(Permissions.IDENTITY_ACCOUNTS_MANAGE)],
      },
      {
        path: 'admin/users/:id',
        loadComponent: () => import('./users/user-detail.js').then((m) => m.UserDetail),
        canActivate: [permissionGuard(Permissions.IDENTITY_ACCOUNTS_MANAGE)],
      },
      {
        path: 'admin/master-data',
        loadComponent: () => import('./master-data/master-data-list.js').then((m) => m.MasterDataList),
        canActivate: [permissionGuard(Permissions.MASTER_DATA_MANAGE)],
      },
      {
        path: 'admin/audit',
        loadComponent: () => import('./audit/audit-list.js').then((m) => m.AuditList),
        canActivate: [permissionGuard(Permissions.REPORTING_READ)],
      },
      {
        path: 'clinical/patients',
        loadComponent: () => import('./patients/patient-list.js').then((m) => m.PatientList),
        canActivate: [permissionGuard(Permissions.PATIENTS_READ)],
      },
      {
        path: 'clinical/patients/:id',
        loadComponent: () => import('./patients/patient-detail.js').then((m) => m.PatientDetail),
        canActivate: [permissionGuard(Permissions.PATIENTS_READ)],
      },
      {
        path: 'clinical/triage',
        loadComponent: () => import('./triage/triage-list.js').then((m) => m.TriageList),
        canActivate: [permissionGuard(Permissions.TRIAGE_READ)],
      },
      {
        path: 'clinical/triage/:id',
        loadComponent: () => import('./triage/triage-detail.js').then((m) => m.TriageDetail),
        canActivate: [permissionGuard(Permissions.TRIAGE_READ)],
      },
      {
        path: 'clinical/appointments',
        loadComponent: () => import('./appointments/appointment-list.js').then((m) => m.AppointmentList),
        canActivate: [permissionGuard('appointment.read')],
      },
      {
        path: 'clinical/appointments/:id',
        loadComponent: () => import('./appointments/appointment-detail.js').then((m) => m.AppointmentDetail),
        canActivate: [permissionGuard('appointment.read')],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
```

Note the platform children carry no `permissionGuard`: `platformGuard` already gates the whole tree, and a Super Admin holds every permission, so per-route checks would be dead weight.

- [ ] **Step 2: Write the failing test for the root redirect guard**

Create `apps/staff-console/src/app/root-redirect.guard.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@org/auth';
import { rootRedirectGuard } from './root-redirect.guard.js';

describe('rootRedirectGuard', () => {
  function setup(isAuthenticated: boolean, isPlatformAdmin: boolean) {
    const authService = {
      isAuthenticated: () => isAuthenticated,
      isPlatformAdmin: () => isPlatformAdmin,
    } as unknown as AuthService;
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    });
  }

  it('sends a platform admin to the platform dashboard', () => {
    setup(true, true);
    const result = TestBed.runInInjectionContext(() =>
      rootRedirectGuard({} as never, { url: '/' } as never),
    );
    expect(result?.toString()).toBe('/platform/dashboard');
  });

  it('sends a tenant user to the tenant landing page', () => {
    setup(true, false);
    const result = TestBed.runInInjectionContext(() =>
      rootRedirectGuard({} as never, { url: '/' } as never),
    );
    expect(result?.toString()).toBe('/billing/invoices');
  });

  it('sends an unauthenticated visitor to /login', () => {
    setup(false, false);
    const result = TestBed.runInInjectionContext(() =>
      rootRedirectGuard({} as never, { url: '/' } as never),
    );
    expect(result?.toString()).toBe('/login');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx test staff-console --testPathPattern=root-redirect`
Expected: FAIL — `root-redirect.guard.js` does not exist.

- [ ] **Step 4: Implement the guard**

Create `apps/staff-console/src/app/root-redirect.guard.ts`:

```typescript
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, PLATFORM_LANDING_URL, TENANT_LANDING_URL } from '@org/auth';

/** Resolves the bare '' URL to whichever landing page matches the signed-in audience. */
export const rootRedirectGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  return router.createUrlTree([
    authService.isPlatformAdmin() ? PLATFORM_LANDING_URL : TENANT_LANDING_URL,
  ]);
};
```

- [ ] **Step 5: Run the tests and build**

Run: `pnpm nx test staff-console --testPathPattern=root-redirect && pnpm nx run staff-console:build`
Expected: PASS both.

- [ ] **Step 6: Fix stale internal links to moved routes**

The Tenants and Global Catalog screens moved. Find and repoint any `routerLink` or `navigateByUrl` still pointing at the old paths:

Run: `grep -rn "'/tenants\|\"/tenants\|/admin/global-catalog\|'/dashboard" apps/staff-console/src`
Expected after fixing: no matches outside `app.routes.ts`. Rewrite `/tenants/...` → `/platform/tenants/...`, `/admin/global-catalog` → `/platform/catalog`, `/dashboard` → `/platform/dashboard`.

- [ ] **Step 7: Rebuild and commit**

```bash
pnpm nx run staff-console:build
git add apps/staff-console/src/app/app.routes.ts apps/staff-console/src/app/root-redirect.guard.ts apps/staff-console/src/app/root-redirect.guard.spec.ts
git add -u apps/staff-console/src
git commit -m "feat: split routes into guarded platform and tenant trees"
```

---

### Task 8: Subdomain resolution and audience-aware login redirect

**Repo:** `frontend`.

**Files:**
- Modify: `apps/staff-console/src/app/app.config.ts:69-73`
- Modify: `apps/staff-console/src/app/login/login.ts:76-89`
- Test: `apps/staff-console/src/app/login/login.spec.ts`

**Interfaces:**
- Consumes: `AuthService.isPlatformAdmin`, `PLATFORM_TENANT_ID`, `PLATFORM_LANDING_URL`, `TENANT_LANDING_URL` from `@org/auth`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Point the `admin` subdomain at the platform tenant**

In `apps/staff-console/src/app/app.config.ts`, add `PLATFORM_TENANT_ID` to the `@org/auth` imports (add an import line if the file does not already import from it):

```typescript
import { PLATFORM_TENANT_ID } from '@org/auth';
```

Replace lines 69-73 — the `admin` → `demo` special case and its comment — with:

```typescript
  // The platform console is served from the 'admin' subdomain; its accounts live in the reserved
  // platform tenant, not inside any hospital. Dev: http://admin.localhost:4200.
  if (subdomain === 'admin') {
    return PLATFORM_TENANT_ID;
  }
```

- [ ] **Step 2: Write the failing test for the login redirect**

Append to the existing `apps/staff-console/src/app/login/login.spec.ts`, adding any imports below that the file does not already have:

```typescript
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { AuthService } from '@org/auth';
import { Login } from './login.js';

describe('Login redirect', () => {
  function setup(isPlatformAdmin: boolean) {
    const authService = {
      login: () => of({ kind: 'success' as const }),
      isPlatformAdmin: () => isPlatformAdmin,
    } as unknown as AuthService;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
      ],
    });
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(Login);
    return { component: fixture.componentInstance, navigate };
  }

  it('sends a platform admin to the platform dashboard', () => {
    const { component, navigate } = setup(true);
    component.usernameControl.setValue('superadmin');
    component.passwordControl.setValue('SuperAdmin@123!');

    component.submit();

    expect(navigate).toHaveBeenCalledWith('/platform/dashboard');
  });

  it('sends a tenant user to the tenant landing page', () => {
    const { component, navigate } = setup(false);
    component.usernameControl.setValue('demoadmin');
    component.passwordControl.setValue('DemoAdmin@123!');

    component.submit();

    expect(navigate).toHaveBeenCalledWith('/billing/invoices');
  });
});
```

`submit()`, `usernameControl`, and `passwordControl` are the names already on the component (`login.ts:45, 49, 56`) — do not rename anything on `Login` to suit the test.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm nx test staff-console --testPathPattern=login`
Expected: FAIL — the platform case navigates to `/billing/invoices`.

- [ ] **Step 4: Make the redirect audience-aware**

In `apps/staff-console/src/app/login/login.ts`, extend the `@org/auth` import:

```typescript
import { AuthService, PLATFORM_LANDING_URL, TENANT_LANDING_URL } from '@org/auth';
```

Replace the `case 'success':` branch (currently lines 78-80) with:

```typescript
      case 'success':
        void this.router.navigateByUrl(
          this.authService.isPlatformAdmin() ? PLATFORM_LANDING_URL : TENANT_LANDING_URL,
        );
        return;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx test staff-console --testPathPattern=login`
Expected: PASS.

- [ ] **Step 6: Run the whole frontend suite and build**

Run: `pnpm nx run-many -t test typecheck build`
Expected: PASS with 0 failures.

- [ ] **Step 7: Manual verification against a reseeded database**

In the backend repo, wipe and reseed so the split accounts exist, then check both consoles:

```bash
docker compose -f new/code/docker-compose.dev.yml --profile seed run --rm seed-all
```

- `http://admin.localhost:4200` → log in `superadmin` / `SuperAdmin@123!` → lands on `/platform/dashboard`; sidebar shows Dashboard, Tenants, Global Catalog, Platform Admins, Platform Audit and **no** clinical entries; Tenants grid does **not** list `__platform`; navigating to `/clinical/patients` bounces back to `/platform/dashboard`.
- `http://localhost:4200` → log in `demoadmin` / `DemoAdmin@123!` → lands on `/billing/invoices`; sidebar shows no Tenants or Global Catalog; navigating to `/platform/tenants` bounces to `/billing/invoices`.

- [ ] **Step 8: Commit**

```bash
git add apps/staff-console/src/app/app.config.ts apps/staff-console/src/app/login/
git commit -m "feat: resolve admin subdomain to platform tenant and redirect by audience"
```

---

### Task 9: Document the pattern

**Repo:** `new_hospital`.

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`
- Modify: `new/docs/technical-design/mvp-status.md`

- [ ] **Step 1: Add a Development-Standards section**

Append to `new/docs/technical-design/Development-Standards.md`, whose current last section is
`## 21. Frontend Theming and Screen Layout`:

```markdown
## 22. Platform vs. tenant altitude

The system has two audiences, and every new screen and endpoint belongs to exactly one.

- **Platform (vendor/ops).** Accounts live in the reserved `__platform` tenant
  (`apps/api/src/tenants/platform-tenant.ts`), never inside a customer hospital. `__platform` is
  excluded from tenant listings and direct fetches, is not provisionable through the API, and
  cannot be suspended. Seeded by `seedPlatformAdmin()`.
- **Tenant (hospital staff).** Accounts live in their hospital's own schema. Seeded for the demo
  hospital by `seedDemoHospitalAdmin()`.

**Platform users have no access to tenant data, and this is structural rather than guarded.**
Tenant scope derives from the JWT's `hospitalId` claim
(`libs/tenant-context/src/lib/tenant-context.middleware.ts`), so a platform user's queries resolve
against the empty `__platform` schema. Do **not** add per-endpoint "is this a platform user" checks
— they are redundant, and adding them implies the boundary depends on remembering them.

**Frontend.** Two shells over two route trees, both wrapping `ShellChrome`:

| | Platform | Tenant |
|---|---|---|
| Shell | `PlatformShell` | `AppShell` |
| Guard | `platformGuard` | `tenantGuard` |
| URLs | `/platform/*` | `/clinical/*`, `/billing/*`, `/admin/*` |
| Landing | `/platform/dashboard` | `/billing/invoices` |
| Dev URL | `http://admin.localhost:4200` | `http://localhost:4200` |

Audience is decided by `AuthService.isPlatformAdmin`, derived from the JWT's `hospitalId` claim —
never from a role name, which is renameable and not authoritative. A new screen picks a tree; it
does not add an `@if` to a shared sidebar. Screens meaningful at both altitudes (`UserList`,
`AuditList`) are routed into both trees pointing at the same component, unparameterized, because
they already scope themselves by the JWT's tenant.
```

- [ ] **Step 2: Record the work in the backlog docs**

Add this entry under `## Phase 5 — New platform capabilities` in `new/docs/technical-design/pending-tasks.md`:

```markdown
- [x] **Platform (Super Admin) console above tenants.** Super Admin accounts moved out of the
  `demo` hospital into a reserved `__platform` system tenant; `staff-console` split into a platform
  console (`/platform/*`, `PlatformShell`) and the tenant console (`AppShell`), guarded by
  `platformGuard`/`tenantGuard` and reached at `admin.*` vs. the bare host. Platform users have no
  access to tenant data — enforced structurally by JWT-derived schema resolution, not by new
  per-endpoint guards. Spec: `new/docs/superpowers/specs/2026-08-13-platform-superadmin-console-design.md`.
  Plan: `new/docs/superpowers/plans/2026-08-13-platform-superadmin-console.md`.
```

Then in `new/docs/technical-design/mvp-status.md`, correct any statement that places the Super
Admin inside the `demo` tenant or describes one combined console. Find them with:

Run: `grep -n -i "super admin\|superadmin\|demo tenant" new/docs/technical-design/mvp-status.md`

- [ ] **Step 3: Verify no stale references remain**

Run: `grep -rn "superadmin.*demo\|admin subdomain.*demo" new/docs/technical-design/`
Expected: no matches asserting the Super Admin lives in `demo`.

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/
git commit -m "docs: document the platform vs tenant altitude split"
```

---

## Post-Plan Review

After Task 9, run `superpowers:requesting-code-review` (Standards + Spec) across both repos' diffs.

Run `security-review` at `high` effort as well: this change touches authentication, tenant isolation, and the platform/tenant trust boundary, which is exactly the category `CLAUDE.md` gates that review on.
