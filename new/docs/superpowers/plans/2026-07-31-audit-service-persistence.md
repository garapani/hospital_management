# Audit Service — Persist Real Audit Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console-logging `LoggingAuditEventPublisher` stub with a real one that persists `audit_records` into the current tenant's schema, and extract the audit wiring out of `AccountsModule` into its own `@Global()` `AuditModule` so every domain module's writes are covered without each declaring its own audit providers. Per `docs/superpowers/specs/2026-07-31-audit-service-persistence-design.md`.

**Architecture:** New `apps/api/src/audit/` domain module, following the exact pattern already established by `apps/api/src/accounts/` and `apps/api/src/tenants/`. `audit_records` is tenant-scoped (lives inside each `tenant_<hospitalId>` schema), so its migration is added to `AccountsService.provisionTenantSchema`'s per-tenant migration list, not `data-source.ts`'s platform-level list. A small prerequisite refactor: `TenantConnectionService` moves from being declared inside `AccountsModule` into the shared `DatabaseModule` (extracted in an earlier plan), since the new audit publisher needs it too and it shouldn't be declared twice.

**Tech Stack:** NestJS/TypeScript, TypeORM, `@hospital/audit-emitter` (already built — `AuditSubscriber`, `AuditEvent`, `AuditEventPublisher`, `AUDIT_EVENT_PUBLISHER`, `@AuditExclude()`), Jest.

## Global Constraints

- Every relative import needs an explicit `.js` extension.
- Use `--testPathPatterns` (plural) if running Jest directly on a subset of files.
- Mutating service methods use load-then-`save()`, never `.update()`/`.increment()`/`.decrement()`.
- A failed audit-record persist must be logged and swallowed, never rethrown — it must not block or fail the business write that triggered it (Global Constraint carried from the design spec; this is a compliance-relevant trade-off already confirmed, not an implementer's judgment call).
- The `audit_records` table is tenant-scoped (inside `tenant_<hospitalId>`, like `accounts`), unlike the platform-level `tenants` table from the prior plan — do not add its migration to `data-source.ts`'s `migrations` array; add it to `AccountsService.provisionTenantSchema`'s per-tenant migration list instead.
- Follow this workspace's git conventions: never `git commit --amend`, never add AI co-authorship trailers, and `git add` only the exact files named in each task — never `git add -A` or `git add .`.

---

### Task 1: Move `TenantConnectionService` into the shared `DatabaseModule`

**Files:**
- Modify: `apps/api/src/database/database.module.ts`
- Modify: `apps/api/src/accounts/accounts.module.ts`

**Interfaces:**
- Produces: `DatabaseModule` now also provides+exports `TenantConnectionService` (in addition to `DataSource`) — consumed by the new `PersistingAuditEventPublisher` in Task 3, and continues to serve `AccountsService` exactly as before.

This is a pure refactor — no behavior change. There is no new test; verification is that the full existing suite still passes unchanged.

- [ ] **Step 1: Add `TenantConnectionService` to `DatabaseModule`**

Replace `apps/api/src/database/database.module.ts` with:

```typescript
import { Global, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TenantContextModule } from '@hospital/tenant-context';
import { createDataSource } from './data-source.js';
import { TenantConnectionService } from './tenant-connection.service.js';

@Global()
@Module({
  imports: [TenantContextModule],
  providers: [
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
    TenantConnectionService,
  ],
  exports: [DataSource, TenantConnectionService],
})
export class DatabaseModule {}
```

`DatabaseModule` now imports `TenantContextModule` itself, because `TenantConnectionService`'s constructor needs `TenantContextService` — required for isolated module compilations (e.g. `Test.createTestingModule({ imports: [SomeModule] })`) to resolve it, even though `TenantContextModule` is also `@Global()`.

- [ ] **Step 2: Remove `TenantConnectionService` from `AccountsModule`'s own providers**

Replace `apps/api/src/accounts/accounts.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { DatabaseModule } from '../database/database.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';
import { LoggingAuditEventPublisher } from './logging-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    { provide: AUDIT_EVENT_PUBLISHER, useClass: LoggingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [DatabaseModule, AccountsService],
})
export class AccountsModule {}
```

This step only removes the `TenantConnectionService` import and its entry from `providers` (it's now supplied by the imported `DatabaseModule`), and simplifies `exports` (dropping the now-redundant explicit `TenantConnectionService` — already covered by re-exporting `DatabaseModule`). Everything else in this file (the audit providers) is untouched here — Task 4 replaces those.

- [ ] **Step 3: Verify nothing broke**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: same as before this task — 14 test suites passed, 66 tests passed, 0 typecheck errors.

- [ ] **Step 4: Commit**

```bash
git add new/code/apps/api/src/database/database.module.ts new/code/apps/api/src/accounts/accounts.module.ts
git commit -m "refactor: move TenantConnectionService into the shared DatabaseModule"
```

---

### Task 2: `AuditRecord` entity and per-tenant migration

**Files:**
- Create: `apps/api/src/audit/entities/audit-record.entity.ts`
- Create: `apps/api/src/database/migrations/1738200000005-create-audit-records-table.ts`
- Modify: `apps/api/src/database/data-source.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`

**Interfaces:**
- Produces: `AuditRecord` entity — consumed by `PersistingAuditEventPublisher` in Task 3.

No test for this task in isolation — same reasoning as the tenant registry plan's entity/migration task: nothing meaningful to assert about an entity with no service atop it yet. Task 3's tests are the first thing that exercises this table.

- [ ] **Step 1: Create the entity**

Create `apps/api/src/audit/entities/audit-record.entity.ts`:

```typescript
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_records')
export class AuditRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  tableName!: string;

  @Column()
  recordId!: string;

  @Column({ type: 'varchar', length: 20 })
  action!: 'create' | 'update' | 'delete';

  @Column({ type: 'varchar', nullable: true })
  changedByAccountId!: string | null;

  @Column({ type: 'varchar', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'jsonb' })
  diff!: unknown;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;
}
```

- [ ] **Step 2: Create the migration**

Create `apps/api/src/database/migrations/1738200000005-create-audit-records-table.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditRecordsTable1738200000005 implements MigrationInterface {
  name = 'CreateAuditRecordsTable1738200000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tableName" varchar NOT NULL,
        "recordId" varchar NOT NULL,
        action varchar(20) NOT NULL,
        "changedByAccountId" varchar NULL,
        "correlationId" varchar NULL,
        diff jsonb NOT NULL,
        "occurredAt" timestamptz NOT NULL
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE audit_records`);
  }
}
```

- [ ] **Step 3: Register the entity in `data-source.ts`**

In `apps/api/src/database/data-source.ts`, add the import:

```typescript
import { AuditRecord } from '../audit/entities/audit-record.entity.js';
```

And add `AuditRecord` to the `entities` array (do **not** add the migration to the `migrations` array — `audit_records` is tenant-scoped, provisioned per-tenant in Step 4 below, not a platform-level `public`-schema migration):

```typescript
    entities: [Role, Permission, RolePermission, Account, AccountRole, Tenant, AuditRecord],
```

- [ ] **Step 4: Provision the migration in `AccountsService.provisionTenantSchema`**

In `apps/api/src/accounts/accounts.service.ts`, add the import:

```typescript
import { CreateAuditRecordsTable1738200000005 } from '../database/migrations/1738200000005-create-audit-records-table.js';
```

And add a third migration step inside `provisionTenantSchema`, after the existing two:

```typescript
      const migration = new CreateTenantAccountTables1738200000001();
      await migration.up(queryRunner);
      const uniqueActiveAssignmentMigration = new AddAccountRolesUniqueActiveAssignment1738200000003();
      await uniqueActiveAssignmentMigration.up(queryRunner);
      const auditRecordsMigration = new CreateAuditRecordsTable1738200000005();
      await auditRecordsMigration.up(queryRunner);
```

This means every *new* tenant schema created from now on (via `provisionTenantSchema`, which every test file already calls in its `beforeAll`) automatically gets an `audit_records` table — no manual `psql` step is needed for this migration, unlike the platform-level migrations in earlier plans, because it's applied dynamically by application code each time a tenant schema is created, not once against a pre-existing shared schema.

- [ ] **Step 5: Verify typecheck still passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t typecheck --skip-nx-cache --projects=api
```

Expected: 0 typecheck errors.

- [ ] **Step 6: Verify the full suite still passes**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test --skip-nx-cache --projects=api
```

Expected: 14 test suites passed, 66 tests passed (every test that calls `provisionTenantSchema` now also creates an `audit_records` table as a side effect, but nothing yet asserts on it, so no test should change behavior).

- [ ] **Step 7: Commit**

```bash
git add new/code/apps/api/src/audit/entities/audit-record.entity.ts new/code/apps/api/src/database/migrations/1738200000005-create-audit-records-table.ts new/code/apps/api/src/database/data-source.ts new/code/apps/api/src/accounts/accounts.service.ts
git commit -m "feat: add AuditRecord entity and per-tenant audit_records migration"
```

---

### Task 3: `PersistingAuditEventPublisher`

**Files:**
- Create: `apps/api/src/audit/persisting-audit-event-publisher.ts`
- Test: `apps/api/src/audit/persisting-audit-event-publisher.integration-spec.ts`

**Interfaces:**
- Consumes: `AuditRecord` entity (Task 2), `TenantConnectionService` (Task 1), `AuditEvent`/`AuditEventPublisher` from `@hospital/audit-emitter`.
- Produces: `PersistingAuditEventPublisher implements AuditEventPublisher` — consumed by `AuditModule` in Task 4.

A failed persist is logged and swallowed, never rethrown (Global Constraints) — the second test below proves this directly.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/audit/persisting-audit-event-publisher.integration-spec.ts`:

```typescript
import { TenantContextService } from '@hospital/tenant-context';
import { createDataSource } from '../database/data-source.js';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';

describe('PersistingAuditEventPublisher (integration)', () => {
  const dataSource = createDataSource();
  const tenantContext = new TenantContextService();
  const tenantConnection = new TenantConnectionService(dataSource, tenantContext);
  const accountsService = new AccountsService(tenantConnection, dataSource);
  const publisher = new PersistingAuditEventPublisher(tenantConnection);

  beforeAll(async () => {
    await dataSource.initialize();
    await accountsService.provisionTenantSchema(dataSource, 'test_audit_persist');
  });

  afterAll(async () => {
    await dataSource.query(`DROP SCHEMA IF EXISTS "tenant_test_audit_persist" CASCADE`);
    await dataSource.destroy();
  });

  function inTenant<T>(work: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId: 'test_audit_persist', correlationId: 'test-correlation' }, work);
  }

  it('persists an audit record into the current tenant schema', async () => {
    await inTenant(() =>
      publisher.publish({
        tableName: 'accounts',
        recordId: '11111111-1111-1111-1111-111111111111',
        action: 'create',
        hospitalId: 'test_audit_persist',
        changedByAccountId: '22222222-2222-2222-2222-222222222222',
        correlationId: 'test-correlation',
        diff: [{ field: 'username', before: null, after: 'dr.alice' }],
        occurredAt: new Date().toISOString(),
      }),
    );

    const records = await inTenant(() =>
      tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(AuditRecord).find({ where: { tableName: 'accounts' } }),
      ),
    );
    expect(records).toHaveLength(1);
    expect(records[0].recordId).toBe('11111111-1111-1111-1111-111111111111');
    expect(records[0].action).toBe('create');
    expect(records[0].correlationId).toBe('test-correlation');
    expect(records[0].diff).toEqual([{ field: 'username', before: null, after: 'dr.alice' }]);
  });

  it('swallows and logs a persist failure instead of throwing (no tenant context set)', async () => {
    await expect(
      publisher.publish({
        tableName: 'accounts',
        recordId: 'x',
        action: 'create',
        diff: [],
        occurredAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});
```

The second test calls `publisher.publish(...)` directly, outside `inTenant(...)` — with no tenant context active, `TenantConnectionService.runInTenantSchema` throws `'No tenant context set — cannot resolve a schema for this query.'`, which is exactly the failure path the publisher must catch and swallow.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec nx test api --testPathPatterns=persisting-audit-event-publisher.integration-spec`

Expected: FAIL with `Cannot find module './persisting-audit-event-publisher.js'` (the publisher doesn't exist yet).

- [ ] **Step 3: Implement `PersistingAuditEventPublisher`**

Create `apps/api/src/audit/persisting-audit-event-publisher.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AuditEvent, AuditEventPublisher } from '@hospital/audit-emitter';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { AuditRecord } from './entities/audit-record.entity.js';

@Injectable()
export class PersistingAuditEventPublisher implements AuditEventPublisher {
  private readonly logger = new Logger(PersistingAuditEventPublisher.name);

  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async publish(event: AuditEvent): Promise<void> {
    try {
      await this.tenantConnection.runInTenantSchema((manager) =>
        manager.getRepository(AuditRecord).save(
          manager.getRepository(AuditRecord).create({
            tableName: event.tableName,
            recordId: event.recordId,
            action: event.action,
            changedByAccountId: event.changedByAccountId ?? null,
            correlationId: event.correlationId ?? null,
            diff: event.diff,
            occurredAt: new Date(event.occurredAt),
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to persist audit record for ${event.tableName}/${event.recordId} (${event.action}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec nx test api --testPathPatterns=persisting-audit-event-publisher.integration-spec`

Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add new/code/apps/api/src/audit/persisting-audit-event-publisher.ts new/code/apps/api/src/audit/persisting-audit-event-publisher.integration-spec.ts
git commit -m "feat: add PersistingAuditEventPublisher"
```

---

### Task 4: `AuditModule`; rewire `AccountsModule` and `AppModule`; retire the logging stub

**Files:**
- Create: `apps/api/src/audit/audit.module.ts`
- Move: `apps/api/src/accounts/audit-wiring.service.ts` → `apps/api/src/audit/audit-wiring.service.ts`
- Delete: `apps/api/src/accounts/logging-audit-event-publisher.ts`
- Modify: `apps/api/src/accounts/accounts.module.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Produces: `AuditModule`, `@Global()`, owning `AuditSubscriber` + `AUDIT_EVENT_PUBLISHER` (now bound to `PersistingAuditEventPublisher`, Task 3) + the `OnModuleInit` wiring that pushes the subscriber onto the shared `DataSource`.

The existing `apps/api/src/accounts/audit-wiring.integration-spec.ts` test is unchanged by this task (still imports `AccountsModule`, still overrides `AUDIT_EVENT_PUBLISHER`) — it's the regression check that the diff-exclusion behavior still works once the wiring moves to a different module. No new test is written in this task; verification is that this existing test (and the full suite) still passes.

- [ ] **Step 1: Move `audit-wiring.service.ts`**

Move `apps/api/src/accounts/audit-wiring.service.ts` to `apps/api/src/audit/audit-wiring.service.ts`, content unchanged:

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

- [ ] **Step 2: Create `AuditModule`**

Create `apps/api/src/audit/audit.module.ts`:

```typescript
import { Global, Module } from '@nestjs/common';
import { AuditSubscriber, AUDIT_EVENT_PUBLISHER } from '@hospital/audit-emitter';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { PersistingAuditEventPublisher } from './persisting-audit-event-publisher.js';
import { AuditWiringService } from './audit-wiring.service.js';

@Global()
@Module({
  imports: [TenantContextModule, DatabaseModule],
  providers: [
    { provide: AUDIT_EVENT_PUBLISHER, useClass: PersistingAuditEventPublisher },
    AuditSubscriber,
    AuditWiringService,
  ],
  exports: [AUDIT_EVENT_PUBLISHER, AuditSubscriber],
})
export class AuditModule {}
```

- [ ] **Step 3: Delete the logging stub**

Delete `apps/api/src/accounts/logging-audit-event-publisher.ts` — it's dead code now, fully replaced by `PersistingAuditEventPublisher`.

- [ ] **Step 4: Rewire `AccountsModule` to import `AuditModule` instead of declaring its own audit providers**

Replace `apps/api/src/accounts/accounts.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AccountsController } from './accounts.controller.js';
import { AccountsService } from './accounts.service.js';

@Module({
  imports: [TenantContextModule, DatabaseModule, AuditModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [DatabaseModule, AccountsService],
})
export class AccountsModule {}
```

This drops the `AuditSubscriber`/`AUDIT_EVENT_PUBLISHER`/`LoggingAuditEventPublisher`/`AuditWiringService` imports and provider entries entirely — they're now owned by `AuditModule`, imported here instead.

- [ ] **Step 5: Wire `AuditModule` into `AppModule`**

In `apps/api/src/app/app.module.ts`, add the import and add `AuditModule` to the `imports` array:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthModule } from '../auth/auth.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
```

(`AuditModule` is `@Global()`, so this line isn't strictly required for the real running app once any module imports it — but it makes the dependency explicit at the composition root, matching how `TenantContextModule` is handled, and costs nothing.)

- [ ] **Step 6: Verify the existing audit-wiring test still passes**

Run: `pnpm exec nx test api --testPathPatterns=audit-wiring.integration-spec`

Expected: PASS — the same test, unchanged, now exercising the relocated wiring path (`AccountsModule` → `AuditModule` → `AuditSubscriber`/`AUDIT_EVENT_PUBLISHER`, instead of `AccountsModule` declaring them directly).

- [ ] **Step 7: Run the full suite**

Run from `new/code`:

```bash
pnpm exec nx run-many -t test typecheck --skip-nx-cache --projects=api
```

Expected: 15 test suites passed (14 from before this plan + Task 3's `persisting-audit-event-publisher.integration-spec.ts`), 68 tests passed (66 + Task 3's 2) — this task (Task 4) adds no new tests, it only relocates wiring and verifies nothing broke. 0 typecheck errors.

- [ ] **Step 8: Commit**

```bash
git add new/code/apps/api/src/audit/audit.module.ts new/code/apps/api/src/audit/audit-wiring.service.ts new/code/apps/api/src/accounts/accounts.module.ts new/code/apps/api/src/app/app.module.ts new/code/apps/api/src/accounts/audit-wiring.service.ts new/code/apps/api/src/accounts/logging-audit-event-publisher.ts
git commit -m "feat: extract AuditModule; wire PersistingAuditEventPublisher into every domain module"
```

Note: `git add` on a path that no longer exists (the moved/deleted files under `apps/api/src/accounts/`) stages the removal correctly alongside the new path under `apps/api/src/audit/` — this produces a clean rename/delete in the commit, same as git's normal handling of a `mv`-then-edit.
