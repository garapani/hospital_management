# Standard Audit Columns Across Entities — Design

**Status:** Approved
**Repos:** `new_hospital` (backend, `new/code`) only.

## Problem Statement

Of 78 entities under `apps/api/src`, coverage of basic audit metadata is inconsistent: 53 have
`createdAt`+`updatedAt`, only 4 also have `createdBy`, and **none** have `updatedBy`,
`deletedAt`, or `deletedBy`. There is no shared base entity class — every entity hand-declares its
own `@CreateDateColumn()`/`@UpdateDateColumn()`, or omits them. No soft-delete mechanism exists
anywhere (`@DeleteDateColumn` has zero uses). The only "delete"-shaped behavior on core records is
ad hoc status flags (patient `deactivate`, tenant `archive`/`suspend`) — a different concept
(reversible business state) from an actual soft-deleted row.

Separately, a generalized append-only audit trail already exists (`audit_records` table, populated
automatically for every entity change via `AuditSubscriber`, capturing the acting account and a
diff) — denormalized `createdBy`/`updatedBy` columns are additive to this, not a replacement: fast
"who touched this row" reads without querying the audit log, at the cost of some duplication.

## Solution

Add six standardized columns — `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `deletedAt`,
`deletedBy` — to ~54 tenant-scoped tables plus a handful of platform-scoped ones. Scope is
"real business/clinical/financial records **and** the lookup/catalog tables admins actively
manage" (patients, admissions, invoices, orders, prescriptions, inventory items, *and* lab test
catalog, chart of accounts, department/ward/bed catalog, insurance payer catalog, fixed-asset
categories, etc. — "who changed this lab test's price" is as real an audit question as "who
created this admission"). Excluded: pure join tables (`account_roles`, `role_permissions`),
append-only event/log tables already timestamped differently (`audit_records`, `reporting_events`,
`notifications`, `payments`, `returns`, `invoice_items`, `bed_transfers`, `stock_transactions`,
`stock_balances`, `ward_stock_transactions`/`ward_stock_balances`, `lab_results`,
`triage_entries`, `medication_administrations`, `journal_lines`, `patient_referrals`), and
numbering-counter tables with no row identity of their own (`billing_sequences`,
`patient_sequences`).

No separate `isSoftDeleted` boolean: TypeORM's `@DeleteDateColumn()` makes `deletedAt IS NOT NULL`
the soft-delete flag itself.

## Implementation Decisions

### 1. Two-tier base class: `AuditableEntity` and `SoftDeletableEntity`

`apps/api/src/database/auditable.entity.ts` — two plain abstract classes (not `@Entity()`-decorated):

```ts
export abstract class AuditableEntity {
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  createdBy!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  updatedBy!: string | null;
}

export abstract class SoftDeletableEntity extends AuditableEntity {
  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
```

Not one flat class: not every entity should be deletable through a normal action even once it has
creation/modification tracking — some may only ever be removed at the schema level (tenant purge),
or should stay permanent once created. Splitting into a base tier (`AuditableEntity`: creation/
modification only) and a soft-delete tier (`SoftDeletableEntity extends AuditableEntity`: adds
`deletedAt`/`deletedBy`) makes that a deliberate per-entity choice in the class declaration itself,
not an accident of which columns happen to exist. In practice nearly every currently in-scope
entity extends `SoftDeletableEntity` — the codebase has no clear case today for an entity that
needs audit tracking but must never be deletable — but the split exists so a future entity that
does have that requirement doesn't need a workaround.

The column's mere presence doesn't force soft-delete behavior: `repository.remove(entity)` still
hard-deletes even on a `SoftDeletableEntity`. Services must call `repository.softRemove(entity)` to
get soft-delete behavior (deletedAt/deletedBy populated, row excluded from normal `find()`/query
builder reads afterward) — this is a per-call-site decision, documented in §4 below for the
concrete cases found.

`createdBy`/`updatedBy`/`deletedBy` are nullable `uuid` with no FK constraint — matches the existing
convention on `invoices.createdBy`/`journal_entries.createdBy`/`nursing_tasks.createdBy` (all plain
`uuid`, no FK to `accounts`). Nullable because ALTER-ing existing populated tables with a `NOT NULL`
column requires a backfill default this data doesn't have, and some future write paths (system
jobs) may have no account context.

For the 53 entities that already declare their own `createdAt`/`updatedAt` (and 4 with `createdBy`),
those field declarations are **removed** from the entity class once it extends the base class —
same column name, now inherited, no migration needed for those specific columns (only the net-new
ones per table: `createdBy` unless already present, `updatedBy`, and — for `SoftDeletableEntity`
entities — `deletedAt`, `deletedBy`).

**Ripple effect worth knowing about before touching more entities:** a handful of services define
`CreateXInput`/`UpdateXInput` types as `Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | ...>`. Once
an entity gains new required-looking properties from the base class, those literal omits no longer
cover them, breaking every call site with a confusing "missing properties" error. Fix: replace the
literal `'createdAt' | 'updatedAt'` with `keyof SoftDeletableEntity` (or `keyof AuditableEntity` for
the base tier) in the `Omit`. Found and fixed in `encounters.service.ts` (`ClinicalNote`,
`Diagnosis`, `Prescription`) and `vitals.service.ts` (`Vital`) — grep for `Omit<` against any entity
before/after extending it to check for this.

### 2. Auto-populating `createdBy`/`updatedBy`/`deletedBy`

A new `@EventSubscriber()` (`apps/api/src/database/audit-columns.subscriber.ts`), wired the same way
`AuditSubscriber` is — pushed onto `dataSource.subscribers` from a small wiring service's
`onModuleInit()`, not the TypeORM `subscribers:` DataSource-options array (matching the existing
`AuditWiringService`/`ReportingSubscriber`/`NotificationsSubscriber` pattern so it fires identically
for both the plain injected `DataSource` and `TenantConnectionService.runInTenantSchema()`'s
queryRunner-scoped `EntityManager`, since both come from the same `DataSource` instance).

- `beforeInsert`/`beforeUpdate`: guarded on `instanceof AuditableEntity` (matches both tiers, since
  `SoftDeletableEntity extends AuditableEntity`). `beforeInsert` sets `createdBy` and `updatedBy` to
  `TenantContextService.getAccountId()` (same source `AuditSubscriber` already reads from — no new
  context mechanism) **only if not already set**; `beforeUpdate` sets `updatedBy` unconditionally
  (no entity currently sets this — nothing to clobber).
- `beforeSoftRemove`: guarded on `instanceof SoftDeletableEntity` specifically (the narrower tier —
  a base-tier `AuditableEntity` has no `deletedBy` field to set). Sets `deletedBy` unconditionally.

Guarding on `instanceof` (rather than an exclude-decorator like `AuditSubscriber`'s opt-out) because
this is an opt-in column set, not a blanket cross-cutting behavior — only entities that explicitly
extend one of the two base classes are touched.

**Why `beforeInsert` only fills a gap, never overwrites:** three of the four entities that already
have `createdBy` (`Invoice`, `JournalEntry`, `NursingTask`) resolve it themselves in their service
layer via a pre-existing `resolveActor()` helper with its own anti-spoofing checks, before the
insert ever reaches TypeORM (see e.g. `invoices.service.ts`'s "`createdBy` must never be null"
comment). This subscriber must not silently replace an already-resolved value — it only fills
`createdBy`/`updatedBy` when the entity hasn't set them itself, making it a no-op for those three
and a real auto-population for everything else.

**`Tenant` is excluded from both base classes entirely** — not just from the auto-population, from
extending either tier at all. `tenants.createdBy` is `varchar`, not `uuid`: it's a free-text
actor field that already stores non-account values like `'ops.alice'` or `'seed-initial-setup'`
(its own `resolveActor()` in `tenants.service.ts`), a genuine type mismatch with the shared `uuid`
column, not just a duplicate-write risk. `Tenant` also already has its own lifecycle field
(`archivedAt`) filling the role a generic `deletedAt` would — exactly the kind of "keep it separate"
case §5 already calls out for status-flag-based soft delete, just discovered one level deeper than
expected. `tenants` gets no new columns from this task.

### 3. Migrations

One new migration per schema type, each a single file with multiple `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS` statements (matching the established multi-statement pattern in
`0031-add-catalog-prices.ts`) — not one migration per table:

- **Tenant-scoped** (`TENANT_MIGRATIONS`): adds the missing columns (`createdBy` where absent,
  `updatedBy`, `deletedAt`, `deletedBy` everywhere) across the ~54 in-scope tenant tables.
- **Platform-scoped** (`PLATFORM_MIGRATIONS`): same, for `subscriptions`, `subscription_invoices`,
  `tenant_branding`, `roles`, `permissions`, `department_catalog`, `packages` (global catalogs
  platform admins manage — `role_permissions` stays excluded as a pure join table; `tenants` is
  excluded per the note above).

Both use `ADD COLUMN IF NOT EXISTS` (idempotent, matching `0050`'s established defensive style) and
ship `down()` migrations dropping the same columns.

### 4. The real hard-delete gaps: `Prescription`, `Diagnosis`, `Vital`

Research confirmed the codebase already avoids hard deletes on core records almost entirely (patient
"delete" is a status flag; admissions/invoices/orders/etc. have no delete call sites at all). Three
genuine exceptions, all now converted from `repository.remove(entity)` to
`repository.softRemove(entity)` (all three entities extend `SoftDeletableEntity`):

- `EncountersService.deletePrescription()` (`encounters.service.ts`) — `DELETE
  /patients/:patientId/prescriptions/:id`.
- `EncountersService.deleteDiagnosis()` (`encounters.service.ts`) — same module, same reasoning.
- `VitalsService.void()` (`vitals.service.ts`) — despite the method name, this was a hard delete
  before the fix, not the soft-delete-adjacent behavior "void" implies.

Each `softRemove()` populates `deletedAt`/`deletedBy` via `AuditColumnsSubscriber` and makes the row
invisible to normal `find()`/query-builder reads (TypeORM's default soft-delete behavior) — no
application-level `WHERE deletedAt IS NULL` needed anywhere.

No other entity needs a delete-call-site conversion — the `deletedAt`/`deletedBy` columns exist and
are ready for future use elsewhere, but nothing else currently calls delete on them.

### 5. Scope boundary — deactivate/archive/suspend stay separate

Patient `deactivate`, tenant `archive`/`suspend` are **not** touched or replaced by the new
`deletedAt` column — they represent a different concept (a reversible business state a record can
be in while still fully present and queryable in normal flows), not a removed row. Conflating them
would be a real modeling mistake: a deactivated patient must still show up in most patient searches
(with a status badge), while a soft-deleted row is invisible to `find()` by design.

### 6. `createdBy`/`updatedBy`/`deletedBy` are `varchar`, not `uuid` — corrected mid-implementation

The first draft of `AuditableEntity` typed these columns `uuid`, matching `invoices.createdBy`/
`journal_entries.createdBy`/`nursing_tasks.createdBy`. Running the full backend suite against the
real migration immediately surfaced the problem: `TenantContextService.getAccountId()` is populated
straight from the JWT's `sub` claim (`auth-context.middleware.ts`) with no format validation — real
logins always carry a genuine `accounts.id` uuid there, but this codebase's own test suite routinely
signs tokens with human-readable `sub` values (`'ops.alice'`, `'master-data-controller-admin'`,
etc.), which a `uuid`-typed column rejects outright (`invalid input syntax for type uuid`) on the
first insert/update any such test performs — over 200 test failures on the first full-suite run
after wiring the subscriber. Fixed by switching the type to `varchar`, matching `tenants.createdBy`'s
existing precedent instead. This is an audit-trail actor label, not a column anything joins against
or validates structurally — varchar loses nothing meaningful for production traffic (a real uuid is
still valid varchar content) while accommodating the test convention without rewriting it.

**Lesson for the next person touching this pattern:** don't assume a "the value always comes from a
real logged-in account" invariant holds in every environment this code runs in — test fixtures in
this codebase deliberately favor readable identifiers over realistic ones, and a DB-level type
constraint is the wrong place to enforce a shape assumption that's only true in production.

### 7. Verifying against the actual DB schema, not the entity class, saved this from a worse bug

Before writing the migration, the working assumption was "`createdAt`/`updatedAt` already exist on
nearly every in-scope table, so the migration only needs to add the 4 new columns." That assumption
was wrong for 6 tables (`roles`, `permissions`, `patient_addresses`, `patient_kins` — missing both;
`beds`, `departments`, `wards`, `department_catalog`, `packages`, `subscriptions` — missing
`updatedAt`), verified by grepping each table's *original CREATE TABLE migration*, not the entity
class as last read (the entity class only tells you what TypeScript expects, not what's actually on
disk — a distinction the `migration-safety-check` skill exists to enforce for exactly this reason).
The gap was caught by the full backend test suite provisioning a fresh tenant schema and hitting
`column "createdAt" of relation "roles" does not exist` on the very first RBAC-catalog seed — not by
manual review. Running the full suite against a real migration (not just `typecheck`) is what this
class of bug needs to surface; a passing `tsc --build` says nothing about whether the SQL is right.

### 8. `PLATFORM_MIGRATIONS` need an explicit `nx run api:migrate`; they don't auto-apply per test run

Unlike `TENANT_MIGRATIONS` (replayed fresh for every tenant schema `setupTenantTestContext`
provisions, so a new tenant-scoped migration is exercised automatically by the next full-suite run),
`PLATFORM_MIGRATIONS` apply once to the single shared public schema and are **not** re-run
automatically by the test suite — `apps/api/src/testing/tenant-test-context.ts` has no
`PLATFORM_MIGRATIONS`-running code at all. A new platform-scoped migration needs `pnpm exec nx run
api:migrate` run explicitly against the dev/test database before any test exercising that schema
will see it (and `pnpm exec nx run api:migrate-tenants` to backfill already-provisioned tenant
schemas with a new *tenant*-scoped migration, for the same reason — a fresh `setupTenantTestContext`
call runs `TENANT_MIGRATIONS` from scratch, but a tenant schema that already existed before the new
migration was added won't have it until backfilled). Both were required here and are now part of the
standard rollout sequence for any future schema-touching task, not just this one.

## Testing Decisions

Touches every business/clinical/financial entity plus a real behavior change (soft-delete on
`Prescription`) — full `TenantTestContext`-based integration coverage per `CLAUDE.md`'s risk-scaling
rule:

- A new integration spec for the subscriber: create/update/soft-remove an in-scope entity through
  its real service, assert `createdBy`/`updatedBy`/`deletedBy` are populated from the request's
  account context.
- Extend `encounters.service.integration-spec.ts` (or equivalent) to confirm `deletePrescription`
  now soft-deletes: the row's `deletedAt`/`deletedBy` are set, and a subsequent list/find no longer
  returns it (proving TypeORM's default exclusion works end-to-end through
  `TenantConnectionService.runInTenantSchema()`, not just in isolation).
- Full backend suite green — a removed duplicate `createdAt`/`updatedAt` field declaration compiling
  correctly on ~53 already-existing entities is a real risk (TypeORM duplicate-column errors,
  serialization shape changes) the full suite's existing fixtures will surface.

## Non-Goals

- Does not convert any status-flag-based "soft delete" (patient deactivate, tenant archive/suspend)
  to use the new `deletedAt` column — different concept, explicitly out of scope (§5 above).
- Does not add FK constraints from `createdBy`/`updatedBy`/`deletedBy` to `accounts.id` — matches
  the existing convention on the 4 entities that already have `createdBy`.
- Does not touch `role_permissions` (join table) or any append-only log/event table — the only
  platform-scoped exclusions.
