# Reporting Dashboard Read APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the reporting event archiver a real read side — a filterable event list plus two
dashboard aggregations, permission-gated via a new `reporting.read` permission.

**Architecture:** A new `ReportingQueryService` reads `reporting_events` through the main
connection pool (`TenantConnectionService.runInTenantSchema()`), never the dedicated write-only
`REPORTING_DATA_SOURCE` pool. A new `ReportingController` exposes it as three `GET` endpoints,
added to the existing `ReportingModule`. RBAC wires the already-seeded-but-unused
`Auditor/Compliance` role to the new permission.

**Tech Stack:** NestJS, TypeORM `QueryBuilder` (including raw jsonb/`date_trunc` expressions),
existing `PermissionGuard`/`RequirePermission` pattern.

## Global Constraints

- **Scope: query endpoint + 2 aggregation endpoints + RBAC only.** Export endpoints (CSV/PDF for
  government/operational reports) are explicitly deferred — a separate, not-yet-scoped product
  question (which formats, for whom), not part of this plan.
- **Reads go through the main pool, never `REPORTING_DATA_SOURCE`.** That pool is capped at 3
  connections specifically so archiver writes never contend with business-transaction connections
  — routing dashboard reads through it would risk starving the archiver of one of only 3
  connections, defeating why it's separate in the first place.
- **New permission: `reporting.read`**, mapped to `Super Admin`, `Hospital Admin`, and
  `Auditor/Compliance` — matching this codebase's existing per-domain `.read` permission pattern.
- **No automated tests.** Per the human partner's standing instruction this session, implement
  directly; verification is manual (see Task 3).

---

### Task 1: RBAC — `reporting.read` permission

**Files:**
- Modify: `apps/api/src/rbac/seed-rbac-catalog.ts`

**Interfaces:**
- Produces: a seeded `reporting.read` `Permission` row, granted to `Super Admin`,
  `Hospital Admin`, and `Auditor/Compliance` — Task 3's controller checks this exact permission
  name via `@RequirePermission('reporting.read')`.

- [ ] **Step 1: Add the permission**

`seed-rbac-catalog.ts`'s `PERMISSION_CATALOG` array currently ends with:
```ts
  {
    name: 'billing.manage',
    description: 'Create invoices, record payments, cancel invoices, and manage deposits',
  },
];
```
Add a new entry before the closing `];`:
```ts
  {
    name: 'billing.manage',
    description: 'Create invoices, record payments, cancel invoices, and manage deposits',
  },
  {
    name: 'reporting.read',
    description: 'View reporting events, dashboards, and aggregated metrics.',
  },
];
```

- [ ] **Step 2: Map it to roles**

`ROLE_PERMISSION_MAPPINGS` currently ends with:
```ts
  { roleName: 'Billing/Accounts Staff', permissionName: 'billing.manage' },
];
```
Add three new entries before the closing `];`:
```ts
  { roleName: 'Billing/Accounts Staff', permissionName: 'billing.manage' },
  { roleName: 'Super Admin', permissionName: 'reporting.read' },
  { roleName: 'Hospital Admin', permissionName: 'reporting.read' },
  { roleName: 'Auditor/Compliance', permissionName: 'reporting.read' },
];
```
This is the first permission mapping `Auditor/Compliance` has ever had — the role was seeded with
zero permissions before this.

- [ ] **Step 3: Verify seeding still works**

Run (from `new/code`): `pnpm exec nx test api --testPathPattern=seed-rbac-catalog`
Expected: passes. The existing spec only asserts role *count* (`expect(roles).toHaveLength(14)` at
two places) — it never asserts permission count, so this addition doesn't need a spec update.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/rbac/seed-rbac-catalog.ts
git commit -m "feat(rbac): add reporting.read permission, wire Auditor/Compliance role"
```

---

### Task 2: `ReportingQueryService`

**Files:**
- Create: `apps/api/src/reporting/reporting-query.service.ts`

**Interfaces:**
- Consumes: `TenantConnectionService` (`apps/api/src/database/tenant-connection.service.ts`) —
  `runInTenantSchema<T>(work: (manager: EntityManager) => Promise<T>): Promise<T>`. `ReportingEvent`
  (`apps/api/src/reporting/entities/reporting-event.entity.ts`) — already registered in the main
  `DataSource`'s entity list (`data-source.ts:33/44`), no new registration needed.
- Produces: `ReportingQueryService` with `listEvents(params: ListEventsParams)`,
  `getEventCounts(params: DateRangeParams)`, `getRevenue(params: DateRangeParams)` — Task 3's
  controller calls these three methods with these exact parameter shapes.

- [ ] **Step 1: Write the service**

`apps/api/src/reporting/reporting-query.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { TenantConnectionService } from '../database/tenant-connection.service.js';
import { ReportingEvent } from './entities/reporting-event.entity.js';

export interface ListEventsParams {
  eventType?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface DateRangeParams {
  from?: string;
  to?: string;
}

export interface EventCountRow {
  date: string;
  eventType: string;
  count: number;
}

export interface RevenueRow {
  date: string;
  totalAmount: number;
}

const REVENUE_EVENT_TYPES = ['PaymentRecorded', 'DepositReceived'];

@Injectable()
export class ReportingQueryService {
  constructor(private readonly tenantConnection: TenantConnectionService) {}

  async listEvents(params: ListEventsParams): Promise<{ items: ReportingEvent[]; total: number }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;

    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager.createQueryBuilder(ReportingEvent, 'e').orderBy('e.occurredAt', 'DESC');

      if (params.eventType) {
        qb.andWhere('e.eventType = :eventType', { eventType: params.eventType });
      }
      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      qb.skip((page - 1) * limit).take(limit);

      const [items, total] = await qb.getManyAndCount();
      return { items, total };
    });
  }

  async getEventCounts(params: DateRangeParams): Promise<EventCountRow[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(ReportingEvent, 'e')
        .select(`date_trunc('day', e.occurredAt)`, 'date')
        .addSelect('e.eventType', 'eventType')
        .addSelect('COUNT(*)', 'count')
        .groupBy(`date_trunc('day', e.occurredAt)`)
        .addGroupBy('e.eventType')
        .orderBy('date', 'ASC');

      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      const rows = await qb.getRawMany<{ date: Date; eventType: string; count: string }>();
      return rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        eventType: row.eventType,
        count: Number(row.count),
      }));
    });
  }

  async getRevenue(params: DateRangeParams): Promise<RevenueRow[]> {
    return this.tenantConnection.runInTenantSchema(async (manager) => {
      const qb = manager
        .createQueryBuilder(ReportingEvent, 'e')
        .select(`date_trunc('day', e.occurredAt)`, 'date')
        .addSelect(`SUM((e.payload->>'amount')::numeric)`, 'totalAmount')
        .where('e.eventType IN (:...types)', { types: REVENUE_EVENT_TYPES })
        .groupBy(`date_trunc('day', e.occurredAt)`)
        .orderBy('date', 'ASC');

      if (params.from) {
        qb.andWhere('e.occurredAt >= :from', { from: params.from });
      }
      if (params.to) {
        qb.andWhere('e.occurredAt <= :to', { to: params.to });
      }

      const rows = await qb.getRawMany<{ date: Date; totalAmount: string | null }>();
      return rows.map((row) => ({
        date: row.date.toISOString().slice(0, 10),
        totalAmount: Number(row.totalAmount ?? 0),
      }));
    });
  }
}
```
`runInTenantSchema()` already wraps every call in a real transaction with `SET LOCAL ROLE`/
`SET LOCAL search_path` — this service gets tenant-role-scoped reads for free, the same way every
other domain service (e.g. `PatientsService`) does, by construction. Not registered in any module
yet — Task 3 wires it in.

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/reporting/reporting-query.service.ts
git commit -m "feat(reporting): add ReportingQueryService for event list and dashboard aggregations"
```

---

### Task 3: `ReportingController` + wire into `ReportingModule`

**Files:**
- Create: `apps/api/src/reporting/reporting.controller.ts`
- Modify: `apps/api/src/reporting/reporting.module.ts`

**Interfaces:**
- Consumes: `ReportingQueryService` from Task 2. `PermissionGuard`, `RequirePermission` from
  `@hospital/auth-guards`.

- [ ] **Step 1: Write the controller**

`apps/api/src/reporting/reporting.controller.ts`:
```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionGuard, RequirePermission } from '@hospital/auth-guards';
import { ReportingQueryService } from './reporting-query.service.js';

const REQUIRED_PERMISSION = 'reporting.read';

@Controller('reporting')
@UseGuards(PermissionGuard)
export class ReportingController {
  constructor(private readonly reportingQueryService: ReportingQueryService) {}

  @Get('events')
  @RequirePermission(REQUIRED_PERMISSION)
  async listEvents(
    @Query('eventType') eventType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportingQueryService.listEvents({
      eventType,
      from,
      to,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('dashboard/event-counts')
  @RequirePermission(REQUIRED_PERMISSION)
  async getEventCounts(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportingQueryService.getEventCounts({ from, to });
  }

  @Get('dashboard/revenue')
  @RequirePermission(REQUIRED_PERMISSION)
  async getRevenue(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reportingQueryService.getRevenue({ from, to });
  }
}
```

- [ ] **Step 2: Wire into `ReportingModule`**

`apps/api/src/reporting/reporting.module.ts` currently reads:
```ts
import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { TenantContextModule } from '@hospital/tenant-context';
import {
  REPORTING_DATA_SOURCE,
  createReportingDataSource,
} from '../database/reporting-data-source.js';

@Module({
  imports: [TenantContextModule],
  providers: [
    {
      provide: REPORTING_DATA_SOURCE,
      useFactory: async () => {
        const ds = createReportingDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    PersistingReportingEventPublisher,
    ReportingSubscriber,
  ],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule implements OnModuleDestroy {
  constructor(@Inject(REPORTING_DATA_SOURCE) private readonly reportingDataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.reportingDataSource.isInitialized) {
      await this.reportingDataSource.destroy();
    }
  }
}
```
Replace with (adds a `DatabaseModule` import — matching `AuditModule`'s exact precedent at
`apps/api/src/audit/audit.module.ts`, for `TenantConnectionService` — plus the new controller and
service):
```ts
import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PersistingReportingEventPublisher } from './persisting-reporting-event-publisher.js';
import { ReportingSubscriber } from './reporting.subscriber.js';
import { ReportingQueryService } from './reporting-query.service.js';
import { ReportingController } from './reporting.controller.js';
import { TenantContextModule } from '@hospital/tenant-context';
import { DatabaseModule } from '../database/database.module.js';
import {
  REPORTING_DATA_SOURCE,
  createReportingDataSource,
} from '../database/reporting-data-source.js';

@Module({
  imports: [TenantContextModule, DatabaseModule],
  controllers: [ReportingController],
  providers: [
    {
      provide: REPORTING_DATA_SOURCE,
      useFactory: async () => {
        const ds = createReportingDataSource();
        if (!ds.isInitialized) {
          await ds.initialize();
        }
        return ds;
      },
    },
    PersistingReportingEventPublisher,
    ReportingSubscriber,
    ReportingQueryService,
  ],
  exports: [PersistingReportingEventPublisher],
})
export class ReportingModule implements OnModuleDestroy {
  constructor(@Inject(REPORTING_DATA_SOURCE) private readonly reportingDataSource: DataSource) {}

  async onModuleDestroy(): Promise<void> {
    if (this.reportingDataSource.isInitialized) {
      await this.reportingDataSource.destroy();
    }
  }
}
```

- [ ] **Step 3: Typecheck and run the existing suite**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`)
Expected: all projects typecheck clean, full existing suite stays green — this is additive:
one new controller, one new service, one new module import, no existing behavior changed.

- [ ] **Step 4: Manual verification**

Start local Postgres and the API:
```bash
docker-compose -f docker-compose.dev.yml up -d
pnpm exec nx serve api
```

In another terminal, mint two JWTs against a real (or reused) dev tenant — one with
`reporting.read`, one without. `apps/api/src/testing/test-jwt.ts`'s `signTestToken()` and its only
import (`jwt-secret.ts`) have no decorators/DI, unlike `migrate.ts`/`migrate-tenants.ts` (whose tsx
failure is specifically about decorator-parsing through `libs/audit-emitter`), so `tsx` should run
this cleanly:
```bash
cd new/code/apps/api
pnpm exec tsx -e "
import { signTestToken } from './src/testing/test-jwt.js';
const withPerm = await signTestToken({ sub: 'reporting-manual-check', hospitalId: 'YOUR_TENANT_ID', permissions: ['reporting.read'] });
const withoutPerm = await signTestToken({ sub: 'reporting-manual-check-2', hospitalId: 'YOUR_TENANT_ID', permissions: [] });
console.log('WITH:', withPerm);
console.log('WITHOUT:', withoutPerm);
"
```
Replace `YOUR_TENANT_ID` with an already-provisioned dev tenant's `hospitalId` (provision one via
`POST /tenants` with a `system-admin.tenants.manage` token if none exists locally). If this `tsx`
invocation hits an unexpected error, note what actually failed and fall back to an equivalent
plain-Node script signing the same HS256 payload directly with the `JWT_SECRET`/default dev secret
from `jwt-secret.ts` — document whichever approach actually worked.

Trigger at least one tracked business action against that tenant so a real `reporting_events` row
exists — e.g. record a payment (`POST /billing/invoices/:id/payments`) using the `WITH` token
plus whatever permission that endpoint itself requires (`billing.manage` — mint a third token with
both `reporting.read` and `billing.manage` if reusing one token is simpler).

Then verify all three endpoints with the `reporting.read` token:
```bash
curl -s -H "Authorization: Bearer $WITH_PERM_TOKEN" -H "x-tenant-id: YOUR_TENANT_ID" \
  "http://localhost:3000/api/reporting/events?limit=10" | jq .
curl -s -H "Authorization: Bearer $WITH_PERM_TOKEN" -H "x-tenant-id: YOUR_TENANT_ID" \
  "http://localhost:3000/api/reporting/dashboard/event-counts" | jq .
curl -s -H "Authorization: Bearer $WITH_PERM_TOKEN" -H "x-tenant-id: YOUR_TENANT_ID" \
  "http://localhost:3000/api/reporting/dashboard/revenue" | jq .
```
Expected: the events list includes the triggered action (e.g. `PaymentRecorded`), event-counts
shows a row for today's date with that `eventType` and count ≥ 1, and — since `PaymentRecorded` is
a revenue event type — revenue shows a non-zero `totalAmount` for today.

Then confirm the permission gate is real, not just present in source:
```bash
curl -s -o /dev/null -w "status=%{http_code}\n" -H "Authorization: Bearer $WITHOUT_PERM_TOKEN" \
  "http://localhost:3000/api/reporting/events"
```
Expected: `status=403`.

Stop the server (`Ctrl+C`) once confirmed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reporting/reporting.controller.ts apps/api/src/reporting/reporting.module.ts
git commit -m "feat(reporting): add ReportingController with event list and dashboard endpoints"
```

---

### Task 4: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Add a Development-Standards.md section**

Append after the existing `## 10. Connection Pooling` section, which currently ends the file with:
```markdown
See `new/docs/superpowers/plans/2026-08-04-connection-pool-limits.md` for the full implementation
history.
```
Add:
```markdown

## 11. Reporting Dashboard Reads

`ReportingQueryService` (`apps/api/src/reporting/reporting-query.service.ts`) reads
`reporting_events` through the **main** connection pool via
`TenantConnectionService.runInTenantSchema()` — the same pattern every other domain service uses
(e.g. `PatientsService`) — never through the dedicated `REPORTING_DATA_SOURCE` pool
`PersistingReportingEventPublisher` writes through. That write pool is deliberately capped at 3
connections so archiver writes never contend with business-transaction connections; a slow
dashboard aggregation query sharing that pool would risk starving the archiver of one of only 3
connections, defeating the reason it's separate at all. Reads getting tenant-role-scoped
(`SET LOCAL ROLE`/`SET LOCAL search_path`) for free via `runInTenantSchema()` is a side effect of
reusing that pattern, not something built specifically for this feature.

**RBAC:** a new `reporting.read` permission gates all three endpoints
(`GET /reporting/events`, `GET /reporting/dashboard/event-counts`,
`GET /reporting/dashboard/revenue`), mapped to `Super Admin`, `Hospital Admin`, and
`Auditor/Compliance` — the first permission the `Auditor/Compliance` role has ever been granted;
it was seeded with zero permissions before this.

**Deferred:** export endpoints (CSV/PDF for government/operational reports) —
`new-features.md` #13's fourth ask — need real product decisions (which formats, for which
audience) this repo hasn't made anywhere yet, so they're a separate future item, not a mechanical
follow-on to the query endpoints here.

See `new/docs/superpowers/plans/2026-08-05-reporting-dashboard-read-apis.md` for the full
implementation history.
```

- [ ] **Step 2: Check off `pending-tasks.md` Phase 4 item 10**

The line currently reads:
```markdown
10. **Reporting dashboard read APIs** (new-features.md #13) — the event archiver is
    capture-only as of the reporting-archiver session; finishing the read side is the shortest
    path to a shippable feature.
```
Replace with:
```markdown
10. [x] **Reporting dashboard read APIs** (new-features.md #13) — done: `GET /reporting/events`
    (filterable/paginated list), `GET /reporting/dashboard/event-counts` and
    `GET /reporting/dashboard/revenue` (daily aggregations), all gated by a new `reporting.read`
    permission wired to `Super Admin`/`Hospital Admin`/`Auditor/Compliance` (the latter's first-ever
    permission grant). **Not done:** export endpoints (CSV/PDF for government/operational reports)
    — deferred, open product-scoping question on formats/audience.
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document reporting dashboard reads, check off Phase 4 item 10"
```
