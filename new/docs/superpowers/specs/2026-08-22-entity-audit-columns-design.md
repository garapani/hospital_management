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
`deletedBy` — to the ~37 entities representing real business/clinical/financial records (patients,
admissions, invoices, orders, prescriptions, inventory, etc.), plus a handful of platform-scoped
equivalents (tenant registry, subscriptions, subscription invoices, tenant branding). Excluded:
pure join tables, append-only event/log tables (already timestamped differently — `audit_records`,
`reporting_events`, `stock_transaction`-style ledgers), and numbering-counter tables with no row
identity of their own.

No separate `isSoftDeleted` boolean: TypeORM's `@DeleteDateColumn()` makes `deletedAt IS NOT NULL`
the soft-delete flag itself.

## Implementation Decisions

### 1. Shared `AuditableEntity` base class

`apps/api/src/database/auditable.entity.ts` — a plain abstract class (not `@Entity()`-decorated),
extended by every in-scope entity:

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

  @DeleteDateColumn({ type: 'timestamptz' })
  deletedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  deletedBy!: string | null;
}
```

`createdBy`/`updatedBy`/`deletedBy` are nullable `uuid` with no FK constraint — matches the existing
convention on `invoices.createdBy`/`journal_entries.createdBy`/`nursing_tasks.createdBy` (all plain
`uuid`, no FK to `accounts`). Nullable because ALTER-ing existing populated tables with a `NOT NULL`
column requires a backfill default this data doesn't have, and some future write paths (system
jobs) may have no account context.

For the 53 entities that already declare their own `createdAt`/`updatedAt` (and 4 with `createdBy`),
those field declarations are **removed** from the entity class once it extends `AuditableEntity` —
same column name, now inherited, no migration needed for those specific columns (only the 4 net-new
ones per table: `createdBy` unless already present, `updatedBy`, `deletedAt`, `deletedBy`).

### 2. Auto-populating `createdBy`/`updatedBy`/`deletedBy`

A new `@EventSubscriber()` (`apps/api/src/database/audit-columns.subscriber.ts`), wired the same way
`AuditSubscriber` is — pushed onto `dataSource.subscribers` from a small wiring service's
`onModuleInit()`, not the TypeORM `subscribers:` DataSource-options array (matching the existing
`AuditWiringService`/`ReportingSubscriber`/`NotificationsSubscriber` pattern so it fires identically
for both the plain injected `DataSource` and `TenantConnectionService.runInTenantSchema()`'s
queryRunner-scoped `EntityManager`, since both come from the same `DataSource` instance).

- `beforeInsert`: if `event.entity instanceof AuditableEntity`, set `createdBy` and `updatedBy` to
  `TenantContextService.getAccountId()` (same source `AuditSubscriber` already reads from — no new
  context mechanism).
- `beforeUpdate`: set `updatedBy` only.
- `beforeSoftRemove`: set `deletedBy`.

Guarding on `instanceof AuditableEntity` (rather than an exclude-decorator like `AuditSubscriber`'s
opt-out) because this is an opt-in column set, not a blanket cross-cutting behavior — only entities
that explicitly extend the base class are touched.

### 3. Migrations

One new migration per schema type, each a single file with multiple `ALTER TABLE ... ADD COLUMN IF
NOT EXISTS` statements (matching the established multi-statement pattern in
`0031-add-catalog-prices.ts`) — not one migration per table:

- **Tenant-scoped** (`TENANT_MIGRATIONS`): adds the missing columns (`createdBy` where absent,
  `updatedBy`, `deletedAt`, `deletedBy` everywhere) across the ~37 in-scope tenant tables.
- **Platform-scoped** (`PLATFORM_MIGRATIONS`): same, for `tenants`, `subscriptions`,
  `subscription_invoices`, `tenant_branding`.

Both use `ADD COLUMN IF NOT EXISTS` (idempotent, matching `0050`'s established defensive style) and
ship `down()` migrations dropping the same columns.

### 4. The one real hard-delete gap: `Prescription`

Research confirmed the codebase already avoids hard deletes on core records almost entirely (patient
"delete" is a status flag; admissions/invoices/orders/etc. have no delete call sites at all). The
single exception: `EncountersService.deletePrescription()`
(`apps/api/src/clinical/encounters/encounters.service.ts:86`) does `repository.remove(prescription)`
— a genuine hard delete on a `Prescription` entity, reachable via `DELETE
/patients/:patientId/prescriptions/:id`. Since `Prescription` is in scope for the new audit columns,
this becomes `repository.softRemove(prescription)` instead, which populates `deletedAt`/`deletedBy`
via the new subscriber and makes the row invisible to normal `find()`/query-builder reads (TypeORM's
default soft-delete behavior) without an application-level `WHERE deletedAt IS NULL` needed anywhere.

No other entity needs a delete-call-site conversion — the `deletedAt`/`deletedBy` columns exist and
are ready for future use elsewhere, but nothing else currently calls delete on them.

### 5. Scope boundary — deactivate/archive/suspend stay separate

Patient `deactivate`, tenant `archive`/`suspend` are **not** touched or replaced by the new
`deletedAt` column — they represent a different concept (a reversible business state a record can
be in while still fully present and queryable in normal flows), not a removed row. Conflating them
would be a real modeling mistake: a deactivated patient must still show up in most patient searches
(with a status badge), while a soft-deleted row is invisible to `find()` by design.

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
- Does not touch the 9 platform-scoped entities excluded as join/lookup/log (rbac catalog,
  department catalog, packages) — borderline lookup/catalog tables stay out of scope for now per the
  "all business/clinical/financial entities" scoping decision.
