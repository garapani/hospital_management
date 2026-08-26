# Accounts & Roles Admin API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin-facing HTTP API for account and role-assignment management on top of the existing Identity & Access Service — create staff account, list/get/deactivate/reactivate accounts, admin unlock, and assign/revoke time-bound role assignments — gated by a real permission (`identity.accounts.manage`) and audited via `@hospital/audit-emitter`.

**Architecture:** New `AccountsController` alongside the existing `AuthController`, guarded by `@hospital/auth-guards`' `PermissionGuard`. New `AccountsService` methods layer on top of `TenantConnectionService` exactly like the existing ones. `AuthService.login`'s `permissions: []` placeholder becomes a real lookup through a new platform-level `role_permissions` → `permissions` resolution. `@hospital/audit-emitter`'s `AuditSubscriber` is pushed onto the shared `DataSource.subscribers` array at module-init time (a plain TypeORM `DataSource`, not `@nestjs/typeorm`, so there is no automatic subscriber wiring — this plan does it by hand), publishing through a stub `LoggingAuditEventPublisher` (`console`-based; no message broker exists yet).

**Tech Stack:** NestJS, TypeORM (hand-managed `DataSource`), `@hospital/auth-guards` (`PermissionGuard`, `RequirePermission`), `@hospital/audit-emitter` (`AuditSubscriber`, `AuditExclude`, `AuditEventPublisher`), Postgres 16 via the existing `docker-compose.dev.yml`.

## Global Constraints

- Node 20 LTS, pnpm, Nx (`new/code/`).
- All relative imports use explicit `.js` extensions (NodeNext module resolution).
- Never `git commit --amend`; never a `Co-Authored-By: Claude` trailer.
- Jest CLI on this workspace's version uses `--testPathPatterns` (plural), not the singular `--testPathPattern` — using the singular form errors out instead of running tests.
- A workspace library used by an app needs an explicit `"@hospital/<lib>": "workspace:*"` entry in that app's own `package.json` — TypeScript path mapping alone isn't sufficient (see `new/code/CLAUDE.md`).
- TypeORM subscriber hooks (`afterInsert`/`afterUpdate`/`afterRemove`) only fire for `Repository.save()`/`.remove()` (which hydrate entities through `EntityPersistExecutor`) — **not** for `Repository.update()`/`.increment()`/`.decrement()` (raw query-builder calls that bypass it). Every new mutating method in this plan must use load-then-`save()`, not `update()`, or its audit event will silently never fire.
- `tsconfig*.json` and lint/format config files are blocked from `Edit`/`Write` by a repo hook (`guard-config.sh`) — none of this plan's tasks touch those files, so this shouldn't come up, but if it does, stop and get explicit human sign-off rather than routing around the hook.

---

### Task 1: Permission Catalog — Unique Constraint + Seed Data

**Files:**
- Create: `apps/identity-access/src/database/migrations/1738200000002-add-role-permissions-unique-constraint.ts`
- Modify: `apps/identity-access/src/database/data-source.ts` (register the new migration)
- Modify: `apps/identity-access/src/rbac/seed-rbac-catalog.ts` (seed the permission + its role mappings)
- Modify: `apps/identity-access/src/rbac/seed-rbac-catalog.integration-spec.ts` (add coverage for the new seed data)

**Interfaces:**
- Consumes: `Role`, `Permission`, `RolePermission` entities (all exist, Task 4 of the core-auth plan).
- Produces: after `seedRbacCatalog(dataSource)` runs, a `permissions` row named `identity.accounts.manage` exists, and `role_permissions` links it to both `Hospital Admin` and `Super Admin`. Task 2 (`getPermissionNamesForRoles`) and Task 6 (the 403 test) both depend on this data existing.

`role_permissions` currently has no unique constraint on `(roleId, permissionId)` — the `roles.name` and `permissions.name` columns already have `unique: true`, which is what let the existing seed script use a race-safe `.orIgnore()` insert (see the `new/code/CLAUDE.md`-documented lesson from the core-auth plan). Without a matching constraint on `role_permissions`, a find-then-insert seed for that table would reintroduce the exact same concurrency race already fixed once for `roles`. This task adds the constraint first so the seed script can use the same atomic pattern.

- [ ] **Step 1: Write the migration**

Create `apps/identity-access/src/database/migrations/1738200000002-add-role-permissions-unique-constraint.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRolePermissionsUniqueConstraint1738200000002 implements MigrationInterface {
  name = 'AddRolePermissionsUniqueConstraint1738200000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE role_permissions
      ADD CONSTRAINT "UQ_role_permissions_role_permission" UNIQUE ("roleId", "permissionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE role_permissions
      DROP CONSTRAINT "UQ_role_permissions_role_permission"
    `);
  }
}
```

- [ ] **Step 2: Register the migration**

Modify `apps/identity-access/src/database/data-source.ts` — add the import and extend the `migrations` array:

```typescript
import { AddRolePermissionsUniqueConstraint1738200000002 } from './migrations/1738200000002-add-role-permissions-unique-constraint.js';
```

```typescript
    migrations: [CreateRbacCatalogTables1738200000000, AddRolePermissionsUniqueConstraint1738200000002],
```

- [ ] **Step 3: Run the migration against the dev database**

```bash
cd new/code
pnpm exec tsx apps/identity-access/src/database/migrate.ts
```

Expected: exits 0. Verify with `docker compose -f docker-compose.dev.yml exec -T identity-access-postgres psql -U identity_access -c '\d role_permissions'` showing the new `UQ_role_permissions_role_permission` constraint.

- [ ] **Step 4: Write the failing test for the new seed data**

Modify `apps/identity-access/src/rbac/seed-rbac-catalog.integration-spec.ts` — add two `it` blocks after the existing three (keep the existing `beforeEach` which clears `role_permissions`/`permissions`/`roles`, so these run against a clean seed each time):

```typescript
  it('creates the identity.accounts.manage permission', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    expect(permission.isActive).toBe(true);
  });

  it('maps identity.accounts.manage to Hospital Admin and Super Admin only', async () => {
    await seedRbacCatalog(dataSource);
    const permission = await dataSource.getRepository(Permission).findOneOrFail({
      where: { name: 'identity.accounts.manage' },
    });
    const mappings = await dataSource.getRepository(RolePermission).find({
      where: { permissionId: permission.id },
    });
    const roles = await dataSource.getRepository(Role).find({
      where: { id: In(mappings.map((m) => m.roleId)) },
    });
    expect(roles.map((r) => r.name).sort()).toEqual(['Hospital Admin', 'Super Admin']);
  });
```

Add the imports this needs at the top of the file:

```typescript
import { In } from 'typeorm';
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=seed-rbac-catalog --skip-nx-cache
```

Expected: FAIL — `identity.accounts.manage` permission not found (seed script doesn't create it yet).

- [ ] **Step 6: Implement the seed extension**

Modify `apps/identity-access/src/rbac/seed-rbac-catalog.ts` — add imports, the two new catalog constants, and extend `seedRbacCatalog`:

```typescript
import { Permission } from './entities/permission.entity.js';
import { RolePermission } from './entities/role-permission.entity.js';
```

```typescript
interface PermissionSeed {
  name: string;
  description: string;
}

const PERMISSION_CATALOG: PermissionSeed[] = [
  {
    name: 'identity.accounts.manage',
    description: 'Create, list, deactivate, unlock accounts and manage role assignments.',
  },
];

interface RolePermissionMapping {
  roleName: string;
  permissionName: string;
}

const ROLE_PERMISSION_MAPPINGS: RolePermissionMapping[] = [
  { roleName: 'Hospital Admin', permissionName: 'identity.accounts.manage' },
  { roleName: 'Super Admin', permissionName: 'identity.accounts.manage' },
];
```

Replace the body of `seedRbacCatalog`:

```typescript
export async function seedRbacCatalog(dataSource: DataSource): Promise<void> {
  const roleRepository = dataSource.getRepository(Role);
  for (const roleSeed of ROLE_CATALOG) {
    await roleRepository.createQueryBuilder().insert().into(Role).values(roleSeed).orIgnore().execute();
  }

  const permissionRepository = dataSource.getRepository(Permission);
  for (const permissionSeed of PERMISSION_CATALOG) {
    await permissionRepository
      .createQueryBuilder()
      .insert()
      .into(Permission)
      .values(permissionSeed)
      .orIgnore()
      .execute();
  }

  const rolePermissionRepository = dataSource.getRepository(RolePermission);
  for (const mapping of ROLE_PERMISSION_MAPPINGS) {
    const role = await roleRepository.findOneOrFail({ where: { name: mapping.roleName } });
    const permission = await permissionRepository.findOneOrFail({ where: { name: mapping.permissionName } });
    await rolePermissionRepository
      .createQueryBuilder()
      .insert()
      .into(RolePermission)
      .values({ roleId: role.id, permissionId: permission.id })
      .orIgnore()
      .execute();
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPatterns=seed-rbac-catalog --skip-nx-cache
```

Expected: PASS, 5 tests (3 existing + 2 new).

- [ ] **Step 8: Run the full suite to check for regressions**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Expected: 0 typecheck errors, all existing suites still green (the seed extension must not break any test that already calls `seedRbacCatalog` in its own `beforeAll`).

- [ ] **Step 9: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/database/migrations/1738200000002-add-role-permissions-unique-constraint.ts new/code/apps/identity-access/src/database/data-source.ts new/code/apps/identity-access/src/rbac/seed-rbac-catalog.ts new/code/apps/identity-access/src/rbac/seed-rbac-catalog.integration-spec.ts
git commit -m "feat: seed identity.accounts.manage permission for Hospital Admin and Super Admin"
```

---

### Task 2: Real Permissions in the JWT

**Files:**
- Modify: `apps/identity-access/src/accounts/accounts.service.ts` (add `getPermissionNamesForRoles`, extend `AccountWithRoles`/`attachRoles` with `roleIds`)
- Modify: `apps/identity-access/src/accounts/accounts.service.integration-spec.ts`
- Modify: `apps/identity-access/src/auth/auth.service.ts`
- Modify: `apps/identity-access/src/auth/auth.service.integration-spec.ts`

**Interfaces:**
- Consumes: `Permission`, `RolePermission` entities; Task 1's seed data.
- Produces: `AccountsService.getPermissionNamesForRoles(roleIds: string[]): Promise<string[]>`. `AccountWithRoles` gains a `roleIds: string[]` field (needed by `AuthService.login` to call the method above — `findByUsernameWithRoles` already computes the underlying `Role[]` internally, just wasn't exposing the ids).

This also refactors `findByUsernameWithRoles`'s role-resolution logic into a shared private helper, since Task 4 needs the identical logic for a by-id lookup (`getAccountWithRoles`) and duplicating it would violate DRY.

- [ ] **Step 1: Write the failing test for `getPermissionNamesForRoles`**

Add to `apps/identity-access/src/accounts/accounts.service.integration-spec.ts`, inside the existing `describe` block (after the existing three `it`s):

```typescript
  it('resolves permission names granted to a set of role ids', async () => {
    const hospitalAdminRole = await dataSource
      .getRepository(Role)
      .findOneOrFail({ where: { name: 'Hospital Admin' } });
    const doctorRole = await dataSource.getRepository(Role).findOneOrFail({ where: { name: 'Doctor' } });

    const permissionsForAdmin = await accountsService.getPermissionNamesForRoles([hospitalAdminRole.id]);
    expect(permissionsForAdmin).toEqual(['identity.accounts.manage']);

    const permissionsForDoctor = await accountsService.getPermissionNamesForRoles([doctorRole.id]);
    expect(permissionsForDoctor).toEqual([]);
  });
```

Add the import this needs at the top of the file:

```typescript
import { Role } from '../rbac/entities/role.entity.js';
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=accounts.service --skip-nx-cache
```

Expected: FAIL — `accountsService.getPermissionNamesForRoles is not a function`.

- [ ] **Step 3: Refactor role-resolution into a shared helper and add `getPermissionNamesForRoles`**

Modify `apps/identity-access/src/accounts/accounts.service.ts`. First, add imports:

```typescript
import { Permission } from '../rbac/entities/permission.entity.js';
import { RolePermission } from '../rbac/entities/role-permission.entity.js';
```

Update the `AccountWithRoles` interface:

```typescript
export interface AccountWithRoles {
  account: Account;
  roleIds: string[];
  roleNames: string[];
}
```

Replace `findByUsernameWithRoles`'s body with a call to a new private `attachRoles` helper, and add `getPermissionNamesForRoles`:

```typescript
  async findByUsernameWithRoles(username: string): Promise<AccountWithRoles | null> {
    const account = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).findOne({ where: { username } }),
    );
    if (!account) {
      return null;
    }
    return this.attachRoles(account);
  }

  async getPermissionNamesForRoles(roleIds: string[]): Promise<string[]> {
    if (roleIds.length === 0) {
      return [];
    }
    const rolePermissions = await this.dataSource
      .getRepository(RolePermission)
      .find({ where: { roleId: In(roleIds) } });
    const permissionIds = [...new Set(rolePermissions.map((rp) => rp.permissionId))];
    if (permissionIds.length === 0) {
      return [];
    }
    const permissions = await this.dataSource
      .getRepository(Permission)
      .find({ where: { id: In(permissionIds) } });
    return permissions.map((permission) => permission.name);
  }

  private async attachRoles(account: Account): Promise<AccountWithRoles> {
    const accountRoles = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(AccountRole).find({ where: { accountId: account.id, isActive: true } }),
    );
    const roleIds = accountRoles.map((accountRole) => accountRole.roleId);
    const roles =
      roleIds.length === 0
        ? []
        : await this.dataSource.getRepository(Role).find({ where: { id: In(roleIds) } });

    return { account, roleIds, roleNames: roles.map((role) => role.name) };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPatterns=accounts.service --skip-nx-cache
```

Expected: PASS, 4 tests (3 existing + 1 new). The existing `findByUsernameWithRoles` tests must still pass unchanged — they only assert on `found?.account.username` and `found?.roleNames`, both preserved by the refactor.

- [ ] **Step 5: Write the failing test for real permissions in the JWT**

Add to `apps/identity-access/src/auth/auth.service.integration-spec.ts`, inside the `describe` block, after the existing `beforeAll` creates `dr.carol` — add a second account with an admin role, then a new test:

Modify the `beforeAll` to also create an admin account:

```typescript
    await tenantContext.run({ tenantId: 'test_auth', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'admin.amy',
        email: 'amy@example.com',
        displayName: 'Admin Amy',
        password: 'correct-password-123',
        roleName: 'Hospital Admin',
      }),
    );
```

(This goes right after the existing `dr.carol` creation call inside the same `beforeAll`.)

Then add the new test:

```typescript
  it("includes the account's real permissions in the JWT, not an empty placeholder", async () => {
    const result = await inTenant(() =>
      authService.login({ username: 'admin.amy', password: 'correct-password-123' }),
    );

    const decoded = jwtService.decode((result as { accessToken: string }).accessToken) as Record<
      string,
      unknown
    >;
    expect(decoded['permissions']).toEqual(['identity.accounts.manage']);
  });
```

- [ ] **Step 6: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=auth.service --skip-nx-cache
```

Expected: FAIL — `decoded['permissions']` is `[]`, not `['identity.accounts.manage']`.

- [ ] **Step 7: Wire the real lookup into `AuthService.login`**

Modify `apps/identity-access/src/auth/auth.service.ts` — change the destructuring and payload construction:

```typescript
    const { account, roleIds, roleNames } = found;
```

```typescript
    const hospitalId = this.tenantContext.getTenantId();
    const permissions = await this.accountsService.getPermissionNamesForRoles(roleIds);
    const payload = {
      sub: account.id,
      roles: roleNames,
      permissions,
      hospitalId,
    };
```

(This replaces the existing `const hospitalId = ...` through `const payload = {...}` block, removing the `permissions: [] as string[]` placeholder and its explanatory comment.)

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPatterns="auth.service|accounts.service" --skip-nx-cache
```

Expected: PASS — 5 tests in `auth.service` (4 existing + 1 new), 4 in `accounts.service`, no regressions.

- [ ] **Step 9: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Expected: 0 typecheck errors, all suites green.

- [ ] **Step 10: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/accounts.service.ts new/code/apps/identity-access/src/accounts/accounts.service.integration-spec.ts new/code/apps/identity-access/src/auth/auth.service.ts new/code/apps/identity-access/src/auth/auth.service.integration-spec.ts
git commit -m "feat: resolve real permissions for the JWT instead of an empty placeholder"
```

---

### Task 3: Audit Logging Wiring

**Files:**
- Modify: `apps/identity-access/src/accounts/entities/account.entity.ts` (`@AuditExclude()` on `passwordHash`)
- Create: `apps/identity-access/src/accounts/logging-audit-event-publisher.ts`
- Create: `apps/identity-access/src/accounts/audit-wiring.service.ts`
- Modify: `apps/identity-access/src/accounts/accounts.module.ts`
- Modify: `apps/identity-access/package.json` (add `@hospital/audit-emitter` dependency)
- Test: `apps/identity-access/src/accounts/audit-wiring.integration-spec.ts`

**Interfaces:**
- Consumes: `AuditSubscriber`, `AuditEmitterModule`, `AUDIT_EVENT_PUBLISHER`, `AuditEvent`, `AuditEventPublisher`, `AuditExclude` — all from `@hospital/audit-emitter` (exists, unused by any app until now).
- Produces: every `Repository.save()`/`.remove()` call against `Account`/`AccountRole` inside `AccountsModule`'s `DataSource` now publishes an `AuditEvent` via `LoggingAuditEventPublisher`, with `passwordHash` excluded from the diff. Tasks 4 and 5's mutating methods depend on this being wired in first, since it's what makes their mutations auditable.

A plain `new DataSource(...)` (this app's pattern, not `@nestjs/typeorm`) has no automatic subscriber discovery — `AuditWiringService.onModuleInit()` pushes the DI-constructed `AuditSubscriber` (which itself needs `AUDIT_EVENT_PUBLISHER` and `TenantContextService` injected) onto `dataSource.subscribers` by hand. `DataSource.subscribers` is `readonly` only in the sense that the property can't be reassigned — the array it points to is a plain mutable array, read fresh by TypeORM's `Broadcaster` on every event, including from `TenantConnectionService`'s manually-created `QueryRunner`s (which reference the same parent `DataSource`) — so this works for tenant-scoped queries too, not just the plain `dataSource.manager`.

- [ ] **Step 1: Add the workspace dependency**

Modify `apps/identity-access/package.json` — add to `dependencies`:

```json
    "@hospital/audit-emitter": "workspace:*",
```

```bash
cd new/code
pnpm install
```

- [ ] **Step 2: Exclude `passwordHash` from audit diffs**

Modify `apps/identity-access/src/accounts/entities/account.entity.ts` — add the import and decorator:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { AuditExclude } from '@hospital/audit-emitter';
```

```typescript
  @Column({ type: 'varchar', nullable: true })
  @AuditExclude()
  passwordHash!: string | null;
```

(Replaces the existing `passwordHash` column declaration, adding the decorator above it.)

- [ ] **Step 3: Write the failing wiring test**

Create `apps/identity-access/src/accounts/audit-wiring.integration-spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { TenantContextService } from '@hospital/tenant-context';
import { AUDIT_EVENT_PUBLISHER, AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';

describe('Audit wiring (integration)', () => {
  it('publishes a create event for a new staff account with passwordHash excluded from the diff', async () => {
    const published: AuditEvent[] = [];
    const testPublisher: AuditEventPublisher = {
      publish: async (event) => {
        published.push(event);
      },
    };

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(AUDIT_EVENT_PUBLISHER)
      .useValue(testPublisher)
      .compile();
    await moduleRef.init();

    const dataSource = moduleRef.get(DataSource);
    const tenantContext = moduleRef.get(TenantContextService);
    const accountsService = moduleRef.get(AccountsService);

    await seedRbacCatalog(dataSource);
    await accountsService.provisionTenantSchema(dataSource, 'test_audit_wiring');

    await tenantContext.run({ tenantId: 'test_audit_wiring', correlationId: 'setup' }, () =>
      accountsService.createStaffAccount({
        username: 'audit.test',
        email: 'audit@example.com',
        displayName: 'Audit Test',
        password: 'a-strong-password',
        roleName: 'Doctor',
      }),
    );

    const accountEvent = published.find((event) => event.tableName === 'accounts');
    expect(accountEvent).toMatchObject({ action: 'create' });
    expect(accountEvent?.diff.some((entry) => entry.field === 'passwordHash')).toBe(false);
    expect(accountEvent?.diff.some((entry) => entry.field === 'username')).toBe(true);

    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_audit_wiring" CASCADE`);
    await dataSource.destroy();
    await moduleRef.close();
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=audit-wiring --skip-nx-cache
```

Expected: FAIL — `published` is empty (no subscriber wired yet), or a compile error if `@hospital/audit-emitter` isn't resolvable yet (confirm Step 1 completed first).

- [ ] **Step 5: Write the stub publisher**

Create `apps/identity-access/src/accounts/logging-audit-event-publisher.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';

@Injectable()
export class LoggingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(LoggingAuditEventPublisher.name);

  async publish(event: AuditEvent): Promise<void> {
    this.logger.log(JSON.stringify(event));
  }
}
```

- [ ] **Step 6: Write the subscriber-wiring service**

Create `apps/identity-access/src/accounts/audit-wiring.service.ts`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditSubscriber } from '@hospital/audit-emitter';

@Injectable()
export class AuditWiringService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditSubscriber: AuditSubscriber,
  ) {}

  onModuleInit(): void {
    this.dataSource.subscribers.push(this.auditSubscriber);
  }
}
```

- [ ] **Step 7: Register everything in `AccountsModule`**

Modify `apps/identity-access/src/accounts/accounts.module.ts` — full replacement:

```typescript
import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { AuditEmitterModule, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { createDataSource } from '../database/data-source.js';
import { AccountsService } from './accounts.service.js';
import { LoggingAuditEventPublisher } from './logging-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Module({
  imports: [TenantContextModule, AuditEmitterModule],
  providers: [
    AccountsService,
    TenantConnectionService,
    {
      provide: DataSource,
      useFactory: async () => {
        const ds = createDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    { provide: AUDIT_EVENT_PUBLISHER, useClass: LoggingAuditEventPublisher },
    AuditWiringService,
  ],
  exports: [AccountsService, DataSource, TenantConnectionService],
})
export class AccountsModule {}
```

- [ ] **Step 8: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPatterns=audit-wiring --skip-nx-cache
```

Expected: PASS, 1 test.

- [ ] **Step 9: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Expected: 0 typecheck errors, all suites green. Run it 2-3 times in a row (`--skip-nx-cache` each time) to confirm no new flakiness — this task adds a second module (`AccountsModule` built standalone in the new test, versus through `AuthModule` in the existing controller tests) that both construct their own `DataSource` against the same live Postgres.

- [ ] **Step 10: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/entities/account.entity.ts new/code/apps/identity-access/src/accounts/logging-audit-event-publisher.ts new/code/apps/identity-access/src/accounts/audit-wiring.service.ts new/code/apps/identity-access/src/accounts/audit-wiring.integration-spec.ts new/code/apps/identity-access/src/accounts/accounts.module.ts new/code/apps/identity-access/package.json new/code/pnpm-lock.yaml
git commit -m "feat: wire @hospital/audit-emitter into AccountsModule with a logging publisher stub"
```

---

### Task 4: AccountsService Admin Methods

**Files:**
- Modify: `apps/identity-access/src/accounts/accounts.service.ts`
- Modify: `apps/identity-access/src/accounts/accounts.service.integration-spec.ts`
- Modify: `apps/identity-access/src/accounts/entities/account-role.entity.ts` (`@AuditExclude()` is not needed here — no sensitive fields — skip; listed for completeness that this file was considered and needs no change)

**Interfaces:**
- Consumes: `attachRoles` (Task 2), `TenantConnectionService`, `NotFoundException`/`ConflictException` from `@nestjs/common`.
- Produces: `listAccounts(limit: number, offset: number): Promise<Account[]>`, `getAccountWithRoles(accountId: string): Promise<AccountWithRoles | null>`, `deactivateAccount(accountId: string): Promise<Account>`, `reactivateAccount(accountId: string): Promise<Account>`, `adminUnlockAccount(accountId: string): Promise<Account>`, `assignRole(accountId: string, roleName: string, startDate?: Date, endDate?: Date): Promise<AccountRole>`, `revokeRoleAssignment(accountId: string, accountRoleId: string): Promise<void>`. `createStaffAccount`'s input gains an optional `needsPasswordUpdate` field. Task 5's `AccountsController` calls every one of these directly.

Every method that mutates an existing row uses load-then-`save()` (per the Global Constraints note on subscriber firing), not `update()`/`increment()` — this is the one place in the codebase where that distinction has an observable effect (Task 3's audit wiring), so it's called out per-step below rather than left implicit.

- [ ] **Step 1: Write the failing tests**

Add to `apps/identity-access/src/accounts/accounts.service.integration-spec.ts`, inside the existing `describe` block:

```typescript
  it('creates a staff account with needsPasswordUpdate set when requested', async () => {
    const account = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'temp.pw.user',
        email: 'temp@example.com',
        displayName: 'Temp Password User',
        password: 'a-temp-password',
        roleName: 'Nurse',
        needsPasswordUpdate: true,
      }),
    );
    expect(account.needsPasswordUpdate).toBe(true);
  });

  it('lists accounts in the current tenant with limit/offset', async () => {
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'list.user.1',
        email: 'l1@example.com',
        displayName: 'List User 1',
        password: 'password-one',
        roleName: 'Nurse',
      }),
    );
    await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'list.user.2',
        email: 'l2@example.com',
        displayName: 'List User 2',
        password: 'password-two',
        roleName: 'Nurse',
      }),
    );

    const firstPage = await inTenant(() => accountsService.listAccounts(1, 0));
    expect(firstPage).toHaveLength(1);
    const allAccounts = await inTenant(() => accountsService.listAccounts(50, 0));
    expect(allAccounts.map((a) => a.username)).toEqual(
      expect.arrayContaining(['list.user.1', 'list.user.2']),
    );
  });

  it('gets a single account by id with its roles', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'getbyid.user',
        email: 'getbyid@example.com',
        displayName: 'Get By Id User',
        password: 'password-three',
        roleName: 'Doctor',
      }),
    );

    const found = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(found?.account.username).toBe('getbyid.user');
    expect(found?.roleNames).toEqual(['Doctor']);

    const notFound = await inTenant(() => accountsService.getAccountWithRoles('00000000-0000-0000-0000-000000000000'));
    expect(notFound).toBeNull();
  });

  it('deactivates and reactivates an account, idempotently', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'deactivate.user',
        email: 'deactivate@example.com',
        displayName: 'Deactivate User',
        password: 'password-four',
        roleName: 'Nurse',
      }),
    );

    const deactivated = await inTenant(() => accountsService.deactivateAccount(created.id));
    expect(deactivated.isActive).toBe(false);
    const deactivatedAgain = await inTenant(() => accountsService.deactivateAccount(created.id));
    expect(deactivatedAgain.isActive).toBe(false);

    const reactivated = await inTenant(() => accountsService.reactivateAccount(created.id));
    expect(reactivated.isActive).toBe(true);

    await expect(
      inTenant(() => accountsService.deactivateAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('admin-unlocks an account, clearing failed attempts and lock', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'unlock.user',
        email: 'unlock@example.com',
        displayName: 'Unlock User',
        password: 'password-five',
        roleName: 'Nurse',
      }),
    );
    await inTenant(() => accountsService.recordFailedLogin(created.id));
    await inTenant(() => accountsService.lockAccount(created.id, new Date(Date.now() + 60_000)));

    const unlocked = await inTenant(() => accountsService.adminUnlockAccount(created.id));
    expect(unlocked.failedLoginAttempts).toBe(0);
    expect(unlocked.lockedUntil).toBeNull();

    await expect(
      inTenant(() => accountsService.adminUnlockAccount('00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });

  it('assigns a role, rejects an unknown role name, and rejects a duplicate active assignment', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'assign.role.user',
        email: 'assignrole@example.com',
        displayName: 'Assign Role User',
        password: 'password-six',
        roleName: 'Nurse',
      }),
    );

    const assignment = await inTenant(() => accountsService.assignRole(created.id, 'Doctor'));
    expect(assignment.roleId).toBeDefined();
    expect(assignment.isActive).toBe(true);

    const found = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(found?.roleNames.sort()).toEqual(['Doctor', 'Nurse']);

    await expect(inTenant(() => accountsService.assignRole(created.id, 'Doctor'))).rejects.toThrow(
      'already holds',
    );
    await expect(inTenant(() => accountsService.assignRole(created.id, 'Nonexistent Role'))).rejects.toThrow(
      'Unknown role',
    );
  });

  it('revokes a role assignment, idempotently, and rejects an unknown assignment id', async () => {
    const created = await inTenant(() =>
      accountsService.createStaffAccount({
        username: 'revoke.role.user',
        email: 'revokerole@example.com',
        displayName: 'Revoke Role User',
        password: 'password-seven',
        roleName: 'Nurse',
      }),
    );
    const assignment = await inTenant(() => accountsService.assignRole(created.id, 'Doctor'));

    await inTenant(() => accountsService.revokeRoleAssignment(created.id, assignment.id));
    const foundAfterRevoke = await inTenant(() => accountsService.getAccountWithRoles(created.id));
    expect(foundAfterRevoke?.roleNames).toEqual(['Nurse']);

    await inTenant(() => accountsService.revokeRoleAssignment(created.id, assignment.id));

    await expect(
      inTenant(() => accountsService.revokeRoleAssignment(created.id, '00000000-0000-0000-0000-000000000000')),
    ).rejects.toThrow('not found');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=accounts.service --skip-nx-cache
```

Expected: FAIL — `needsPasswordUpdate` not accepted, `listAccounts`/`getAccountWithRoles`/`deactivateAccount`/`reactivateAccount`/`adminUnlockAccount`/`assignRole`/`revokeRoleAssignment` are not functions.

- [ ] **Step 3: Implement the new methods**

Modify `apps/identity-access/src/accounts/accounts.service.ts` — add the import:

```typescript
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
```

(Replaces the existing `import { Injectable } from '@nestjs/common';`.)

Update `CreateStaffAccountInput`:

```typescript
export interface CreateStaffAccountInput {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roleName: string;
  needsPasswordUpdate?: boolean;
}
```

Update `createStaffAccount`'s account-creation block to pass the new field through:

```typescript
      const account = await manager.getRepository(Account).save(
        manager.getRepository(Account).create({
          accountType: 'staff',
          username: input.username,
          email: input.email,
          displayName: input.displayName,
          passwordHash,
          needsPasswordUpdate: input.needsPasswordUpdate ?? false,
        }),
      );
```

Add the seven new methods after `attachRoles` (at the end of the class, before the closing brace):

```typescript
  async listAccounts(limit: number, offset: number): Promise<Account[]> {
    return this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).find({ take: limit, skip: offset, order: { createdAt: 'ASC' } }),
    );
  }

  async getAccountWithRoles(accountId: string): Promise<AccountWithRoles | null> {
    const account = await this.tenantConnection.runInTenantSchema((manager) =>
      manager.getRepository(Account).findOne({ where: { id: accountId } }),
    );
    if (!account) {
      return null;
    }
    return this.attachRoles(account);
  }

  async deactivateAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.isActive = false;
      return repository.save(account);
    });
  }

  async reactivateAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.isActive = true;
      return repository.save(account);
    });
  }

  async adminUnlockAccount(accountId: string): Promise<Account> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(Account);
      const account = await repository.findOne({ where: { id: accountId } });
      if (!account) {
        throw new NotFoundException(`Account ${accountId} not found`);
      }
      account.failedLoginAttempts = 0;
      account.lockedUntil = null;
      return repository.save(account);
    });
  }

  async assignRole(accountId: string, roleName: string, startDate?: Date, endDate?: Date): Promise<AccountRole> {
    const role = await this.dataSource.getRepository(Role).findOne({ where: { name: roleName } });
    if (!role) {
      throw new NotFoundException(`Unknown role: ${roleName}`);
    }

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(AccountRole);
      const existing = await repository.findOne({
        where: { accountId, roleId: role.id, isActive: true },
      });
      if (existing) {
        throw new ConflictException(`Account ${accountId} already holds an active assignment of role "${roleName}"`);
      }
      return repository.save(
        repository.create({
          accountId,
          roleId: role.id,
          startDate: startDate ?? null,
          endDate: endDate ?? null,
        }),
      );
    });
  }

  async revokeRoleAssignment(accountId: string, accountRoleId: string): Promise<void> {
    await this.tenantConnection.runInTenantSchema(async (manager) => {
      const repository = manager.getRepository(AccountRole);
      const accountRole = await repository.findOne({ where: { id: accountRoleId, accountId } });
      if (!accountRole) {
        throw new NotFoundException(`Role assignment ${accountRoleId} not found for account ${accountId}`);
      }
      accountRole.isActive = false;
      await repository.save(accountRole);
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm exec nx test identity-access --testPathPatterns=accounts.service --skip-nx-cache
```

Expected: PASS, 11 tests (4 existing + 7 new).

- [ ] **Step 5: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Expected: 0 typecheck errors, all suites green.

- [ ] **Step 6: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/accounts.service.ts new/code/apps/identity-access/src/accounts/accounts.service.integration-spec.ts
git commit -m "feat: add AccountsService admin methods (list, get, deactivate, reactivate, unlock, assign/revoke role)"
```

---

### Task 5: AccountsController — HTTP Admin Endpoints

**Files:**
- Create: `apps/identity-access/src/accounts/dto/create-account.dto.ts`
- Create: `apps/identity-access/src/accounts/dto/assign-role.dto.ts`
- Create: `apps/identity-access/src/accounts/accounts.controller.ts`
- Test: `apps/identity-access/src/accounts/accounts.controller.integration-spec.ts`
- Modify: `apps/identity-access/src/accounts/accounts.module.ts` (register the controller)
- Modify: `apps/identity-access/package.json` (add `@hospital/auth-guards` dependency)

**Interfaces:**
- Consumes: every `AccountsService` method from Task 4; `PermissionGuard`/`RequirePermission` from `@hospital/auth-guards`.
- Produces: the full `/accounts` HTTP surface described in the design spec. `AccountsController` is registered on `AccountsModule`, which `AuthModule` already imports and `AppModule` already imports transitively — no `AppModule` change needed, Nest registers controllers from every module in the tree regardless of import depth.

Every route strips `passwordHash` from the response body via a local `toAccountResponse` helper — the `Account` entity's `passwordHash` field must never appear in an HTTP response, hashed or not.

- [ ] **Step 1: Add the workspace dependency**

Modify `apps/identity-access/package.json` — add to `dependencies`:

```json
    "@hospital/auth-guards": "workspace:*",
```

```bash
cd new/code
pnpm install
```

- [ ] **Step 2: Write the DTOs**

Create `apps/identity-access/src/accounts/dto/create-account.dto.ts`:

```typescript
export class CreateAccountDto {
  username!: string;
  email!: string;
  displayName!: string;
  password!: string;
  roleName!: string;
}
```

Create `apps/identity-access/src/accounts/dto/assign-role.dto.ts`:

```typescript
export class AssignRoleDto {
  roleName!: string;
  startDate?: string;
  endDate?: string;
}
```

- [ ] **Step 3: Write the failing controller test**

Create `apps/identity-access/src/accounts/accounts.controller.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';

describe('AccountsController (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenantContext: TenantContextService;
  let accountsService: AccountsService;

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    tenantContext = moduleRef.get(TenantContextService);
    accountsService = moduleRef.get(AccountsService);
    await accountsService.provisionTenantSchema(dataSource, 'test_accounts_controller');

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_accounts_controller" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  const adminHeaders = {
    'x-tenant-id': 'test_accounts_controller',
    'x-permissions': 'identity.accounts.manage',
  };

  it('creates a staff account with needsPasswordUpdate set, and never returns passwordHash', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.create.user',
        email: 'ctrlcreate@example.com',
        displayName: 'Ctrl Create User',
        password: 'a-temp-password',
        roleName: 'Nurse',
      });

    expect(response.status).toBe(201);
    expect(response.body.username).toBe('ctrl.create.user');
    expect(response.body.needsPasswordUpdate).toBe(true);
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('lists accounts in the tenant', async () => {
    const response = await request(app.getHttpServer()).get('/accounts').set(adminHeaders);
    expect(response.status).toBe(200);
    expect(response.body.some((a: { username: string }) => a.username === 'ctrl.create.user')).toBe(true);
  });

  it('gets, deactivates, reactivates, and unlocks a single account', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.lifecycle.user',
        email: 'ctrllifecycle@example.com',
        displayName: 'Ctrl Lifecycle User',
        password: 'a-lifecycle-password',
        roleName: 'Doctor',
      });
    const accountId = createResponse.body.id;

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set(adminHeaders);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.roleNames).toEqual(['Doctor']);

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/deactivate`)
      .set(adminHeaders);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.isActive).toBe(false);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/reactivate`)
      .set(adminHeaders);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.isActive).toBe(true);

    const unlockResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/unlock`)
      .set(adminHeaders);
    expect(unlockResponse.status).toBe(200);
    expect(unlockResponse.body.failedLoginAttempts).toBe(0);
  });

  it('returns 404 for an unknown account id', async () => {
    const response = await request(app.getHttpServer())
      .patch('/accounts/00000000-0000-0000-0000-000000000000/deactivate')
      .set(adminHeaders);
    expect(response.status).toBe(404);
  });

  it('assigns and revokes a role assignment', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/accounts')
      .set(adminHeaders)
      .send({
        username: 'ctrl.roles.user',
        email: 'ctrlroles@example.com',
        displayName: 'Ctrl Roles User',
        password: 'a-roles-password',
        roleName: 'Nurse',
      });
    const accountId = createResponse.body.id;

    const assignResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(adminHeaders)
      .send({ roleName: 'Doctor' });
    expect(assignResponse.status).toBe(201);
    const accountRoleId = assignResponse.body.id;

    const duplicateResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(adminHeaders)
      .send({ roleName: 'Doctor' });
    expect(duplicateResponse.status).toBe(409);

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/accounts/${accountId}/roles/${accountRoleId}`)
      .set(adminHeaders);
    expect(revokeResponse.status).toBe(200);

    const getResponse = await request(app.getHttpServer()).get(`/accounts/${accountId}`).set(adminHeaders);
    expect(getResponse.body.roleNames).toEqual(['Nurse']);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=accounts.controller --skip-nx-cache
```

Expected: FAIL — `AccountsController`/`accounts.controller.ts` doesn't exist yet (also confirm `@hospital/auth-guards` resolves per Step 1).

- [ ] **Step 5: Implement `AccountsController`**

Create `apps/identity-access/src/accounts/accounts.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { Account } from './entities/account.entity.js';
import { AccountsService } from './accounts.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';

const REQUIRED_PERMISSION = 'identity.accounts.manage';

function toAccountResponse(account: Account): Omit<Account, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = account;
  return rest;
}

@Controller('accounts')
@UseGuards(PermissionGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateAccountDto) {
    const account = await this.accountsService.createStaffAccount({
      ...body,
      needsPasswordUpdate: true,
    });
    return toAccountResponse(account);
  }

  @Get()
  @RequirePermission(REQUIRED_PERMISSION)
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    const accounts = await this.accountsService.listAccounts(
      limit ? Number(limit) : 50,
      offset ? Number(offset) : 0,
    );
    return accounts.map(toAccountResponse);
  }

  @Get(':id')
  @RequirePermission(REQUIRED_PERMISSION)
  async getOne(@Param('id') id: string) {
    const found = await this.accountsService.getAccountWithRoles(id);
    if (!found) {
      throw new NotFoundException(`Account ${id} not found`);
    }
    return { account: toAccountResponse(found.account), roleNames: found.roleNames };
  }

  @Patch(':id/deactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async deactivate(@Param('id') id: string) {
    const account = await this.accountsService.deactivateAccount(id);
    return toAccountResponse(account);
  }

  @Patch(':id/reactivate')
  @RequirePermission(REQUIRED_PERMISSION)
  async reactivate(@Param('id') id: string) {
    const account = await this.accountsService.reactivateAccount(id);
    return toAccountResponse(account);
  }

  @Patch(':id/unlock')
  @RequirePermission(REQUIRED_PERMISSION)
  async unlock(@Param('id') id: string) {
    const account = await this.accountsService.adminUnlockAccount(id);
    return toAccountResponse(account);
  }

  @Post(':id/roles')
  @RequirePermission(REQUIRED_PERMISSION)
  @HttpCode(HttpStatus.CREATED)
  async assignRole(@Param('id') id: string, @Body() body: AssignRoleDto) {
    return this.accountsService.assignRole(
      id,
      body.roleName,
      body.startDate ? new Date(body.startDate) : undefined,
      body.endDate ? new Date(body.endDate) : undefined,
    );
  }

  @Delete(':id/roles/:accountRoleId')
  @RequirePermission(REQUIRED_PERMISSION)
  async revokeRole(@Param('id') id: string, @Param('accountRoleId') accountRoleId: string) {
    await this.accountsService.revokeRoleAssignment(id, accountRoleId);
    return { revoked: true };
  }
}
```

- [ ] **Step 6: Register the controller in `AccountsModule`**

Modify `apps/identity-access/src/accounts/accounts.module.ts` — add the import and the `controllers` array:

```typescript
import { AccountsController } from './accounts.controller.js';
```

```typescript
@Module({
  imports: [TenantContextModule, AuditEmitterModule],
  controllers: [AccountsController],
  providers: [
```

(Insert `controllers: [AccountsController],` as a new line right after the `imports` array, before `providers`.)

- [ ] **Step 7: Run the test to verify it passes**

```bash
pnpm exec nx test identity-access --testPathPatterns=accounts.controller --skip-nx-cache
```

Expected: PASS, 5 tests.

- [ ] **Step 8: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Expected: 0 typecheck errors, all suites green (including the existing `AuthController`/cross-tenant tests, which build their own separate `AuthModule`-based Nest app — confirm no cross-suite interference now that two different controllers each stand up their own app instance in tests).

- [ ] **Step 9: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/dto new/code/apps/identity-access/src/accounts/accounts.controller.ts new/code/apps/identity-access/src/accounts/accounts.controller.integration-spec.ts new/code/apps/identity-access/src/accounts/accounts.module.ts new/code/apps/identity-access/package.json new/code/pnpm-lock.yaml
git commit -m "feat: add AccountsController admin HTTP endpoints for accounts and role assignments"
```

---

### Task 6: Cross-Cutting Permission-Gating Test

**Files:**
- Test: `apps/identity-access/src/accounts/accounts-permission-gating.integration-spec.ts`

**Interfaces:**
- Consumes: the full `AccountsModule` (Task 5) over HTTP via `supertest`, exactly like Task 5's own controller test.

This is the permission-gating equivalent of the core-auth plan's Task 9 (cross-tenant isolation, proven at the real HTTP surface): every new route must reject a caller with no `identity.accounts.manage` permission, not just accept one with it. `PermissionGuard` is exercised for the first time anywhere in this codebase by Task 5's tests (which always send the permission) — this task proves the negative case, which is the one that actually matters for security.

- [ ] **Step 1: Write the test**

Create `apps/identity-access/src/accounts/accounts-permission-gating.integration-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantContextMiddleware, TenantContextService } from '@hospital/tenant-context';
import { DataSource } from 'typeorm';
import { createDataSource } from '../database/data-source.js';
import { seedRbacCatalog } from '../rbac/seed-rbac-catalog.js';
import { AccountsModule } from './accounts.module.js';
import { AccountsService } from './accounts.service.js';

describe('AccountsController permission gating (integration)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let accountId: string;

  const noPermissionHeaders = {
    'x-tenant-id': 'test_permission_gating',
  };

  beforeAll(async () => {
    dataSource = createDataSource();
    await dataSource.initialize();
    await seedRbacCatalog(dataSource);

    const moduleRef = await Test.createTestingModule({ imports: [AccountsModule] })
      .overrideProvider(DataSource)
      .useValue(dataSource)
      .compile();

    const tenantContext = moduleRef.get(TenantContextService);
    const accountsService = moduleRef.get(AccountsService);
    await accountsService.provisionTenantSchema(dataSource, 'test_permission_gating');
    const account = await tenantContext.run(
      { tenantId: 'test_permission_gating', correlationId: 'setup' },
      () =>
        accountsService.createStaffAccount({
          username: 'no.permission.doctor',
          email: 'noperm@example.com',
          displayName: 'No Permission Doctor',
          password: 'a-doctor-password',
          roleName: 'Doctor',
        }),
    );
    accountId = account.id;

    app = moduleRef.createNestApplication();
    app.use(
      new TenantContextMiddleware(tenantContext).use.bind(new TenantContextMiddleware(tenantContext)),
    );
    await app.init();
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_permission_gating" CASCADE`);
    await dataSource.destroy();
    await app.close();
  });

  it('rejects account creation with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .post('/accounts')
      .set(noPermissionHeaders)
      .send({
        username: 'blocked.user',
        email: 'blocked@example.com',
        displayName: 'Blocked User',
        password: 'a-blocked-password',
        roleName: 'Nurse',
      });
    expect(response.status).toBe(403);
  });

  it('rejects listing accounts with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer()).get('/accounts').set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects getting a single account with 403 when no identity.accounts.manage permission is granted', async () => {
    const response = await request(app.getHttpServer())
      .get(`/accounts/${accountId}`)
      .set(noPermissionHeaders);
    expect(response.status).toBe(403);
  });

  it('rejects deactivate/reactivate/unlock with 403 when no identity.accounts.manage permission is granted', async () => {
    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/deactivate`)
      .set(noPermissionHeaders);
    expect(deactivateResponse.status).toBe(403);

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/reactivate`)
      .set(noPermissionHeaders);
    expect(reactivateResponse.status).toBe(403);

    const unlockResponse = await request(app.getHttpServer())
      .patch(`/accounts/${accountId}/unlock`)
      .set(noPermissionHeaders);
    expect(unlockResponse.status).toBe(403);
  });

  it('rejects role assignment and revocation with 403 when no identity.accounts.manage permission is granted', async () => {
    const assignResponse = await request(app.getHttpServer())
      .post(`/accounts/${accountId}/roles`)
      .set(noPermissionHeaders)
      .send({ roleName: 'Nurse' });
    expect(assignResponse.status).toBe(403);

    const revokeResponse = await request(app.getHttpServer())
      .delete(`/accounts/${accountId}/roles/00000000-0000-0000-0000-000000000000`)
      .set(noPermissionHeaders);
    expect(revokeResponse.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd new/code
pnpm exec nx test identity-access --testPathPatterns=accounts-permission-gating --skip-nx-cache
```

Expected: PASS, 5 tests. (This should pass on the first run without any implementation changes — `PermissionGuard` already exists and `AccountsController`'s routes are already decorated with `@RequirePermission` from Task 5. If it fails, that means Task 5's guard wiring has a gap — stop and investigate rather than adjusting this test to match.)

- [ ] **Step 3: Run the complete test suite one final time**

```bash
cd new/code
pnpm exec nx run-many -t typecheck test --projects=identity-access --skip-nx-cache
```

Run it 2-3 times in a row to confirm stability. Expected: 0 typecheck errors, every suite green.

- [ ] **Step 4: Commit**

```bash
cd /Users/venkat/Documents/Venkat/GitRepo/newgensoft/new_hospital
git add new/code/apps/identity-access/src/accounts/accounts-permission-gating.integration-spec.ts
git commit -m "test: add cross-cutting 403 coverage for every accounts admin route without identity.accounts.manage"
```

---

## Self-Review Notes

- **Spec coverage:** create/list/get/deactivate/reactivate ✓ Tasks 4-5; admin unlock ✓ Tasks 4-5; assign/revoke role (time-bound) ✓ Tasks 4-5; permission-gated via `identity.accounts.manage` ✓ Task 1 (seed) + Task 5 (guard); `AuthService.login`'s `permissions: []` placeholder resolved ✓ Task 2; audit logging via `@hospital/audit-emitter` with a stub publisher ✓ Task 3; `passwordHash` never in a diff or an HTTP response ✓ Task 3 (`@AuditExclude`) + Task 5 (`toAccountResponse`); negative permission test ✓ Task 6. Explicitly deferred items (forced password-change, refresh-token rotation, `rbac.changed`) are listed in the spec's Scope section, not silently dropped here.
- **Placeholder scan:** the design spec's stub `LoggingAuditEventPublisher` is implemented as a real, working `console`-based publisher (Task 3) — not a TODO. No task leaves a signature without a body.
- **Type consistency:** `AccountWithRoles` (Task 2) gains `roleIds`, consumed by `AuthService.login` (Task 2) and unchanged by `getAccountWithRoles` (Task 4). `assignRole`'s return type `Promise<AccountRole>` (Task 4) matches the controller's direct pass-through response (Task 5) and the `accountRoleId` used in Task 5's revoke route and Task 4's `revokeRoleAssignment` signature.
- **Subscriber-firing correctness:** every new mutating method in Task 4 (`deactivateAccount`, `reactivateAccount`, `adminUnlockAccount`, `assignRole`, `revokeRoleAssignment`) uses load-then-`save()`, verified against the Global Constraints note — none use `update()`/`increment()`, which would silently skip Task 3's audit subscriber.
