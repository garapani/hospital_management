# Codebase Concerns

**Analysis Date:** 2026-08-01

## Tech Debt

**Per-tenant schema migrations run imperatively from application code:**
- Issue: `AccountsService` (likely tenant-provisioning flow) manually instantiates and runs every migration class in sequence (`new CreateReportingTables0017(); await reportingMigration.up(queryRunner);`) instead of relying on TypeORM's migration runner. Every new migration requires a matching manual edit here.
- Files: `new/code/apps/api/src/accounts/accounts.service.ts:87-92`
- Impact: Easy to forget adding a migration to this list when a new one is created (already happened once — `0017` was added to `data-source.ts` and here in the same commit, but nothing enforces the two stay in sync). Silent no-op if a migration is omitted — new tenants get an incomplete schema with no error.
- Fix approach: Extract the ordered migration list into one shared constant used by both `data-source.ts` and `accounts.service.ts`, or drive tenant provisioning through the standard `DataSource.runMigrations()` API scoped to the tenant schema.

**Migration filename/id numbering is inconsistent:**
- Issue: Migrations mix `NNNN-kebab-case.ts` (`0001-create-rbac-catalog-tables.ts` ... `0017-create-reporting-tables.ts`), one `NNN_snake_case.ts` (`005_create_patient_tables.ts`), and one underscore variant among dashes (`0011_create_encounter_tables.ts`). Migration `0008` is missing from the sequence entirely.
- Files: `new/code/apps/api/src/database/migrations/`
- Impact: Ambiguous ordering makes it hard to tell if `0008` was deleted/renamed or never existed; increases risk of a future migration reusing a number or being inserted out of order.
- Fix approach: Standardize on one naming convention and either backfill/document the gap at `0008` or renumber `005_create_patient_tables.ts` to fit the `NNNN-` scheme.

**Widespread use of `any` in reporting event catalog and bootstrap code:**
- Issue: `ReportingSubscriber`'s `eventCatalog` map types `buildPayload` with `entity: any`, `InsertEvent<any>`, and `Record<string, any>`; `afterInsert(event: InsertEvent<any>)` follows suit. `main.ts` casts `app as any` twice for Swagger setup.
- Files: `new/code/apps/api/src/reporting/reporting.subscriber.ts:20-24,116`, `new/code/apps/api/src/main.ts:22-23`
- Impact: Loses compile-time safety for the event-catalog dispatch table — a typo in a payload field name won't be caught until runtime. The `main.ts` casts likely paper over a NestJS/Swagger type mismatch that should be resolved via correct typing instead of suppression.
- Fix approach: Replace the `Function`-keyed `Map` with a discriminated union or a generic helper (`registerHandler<T>(entity: Type<T>, handler: (e: T) => ...)`) to preserve per-entity types. Investigate root cause of the `any` cast in `main.ts` (likely NestJS Express adapter typing) and use a properly typed `INestApplication`.

## Known Bugs

Not detected in current diff/tree — no repro steps or open bug reports found in code comments or issue trackers checked (`TODO`/`FIXME`/`HACK`/`XXX` grep across `apps/api/src` returned zero hits).

## Security Considerations

**Reporting events swallow publish failures silently (best-effort only):**
- Risk: `ReportingSubscriber.afterInsert` catches all errors from `buildPayload`/`publisher.publish` and only logs them — the triggering business transaction (order placement, invoice creation, admission, etc.) already committed by the time this subscriber runs, so failures here are invisible to callers and to any audit trail beyond the app log.
- Files: `new/code/apps/api/src/reporting/reporting.subscriber.ts:134-142`
- Current mitigation: Errors are logged via `Logger.error` with the failing event type.
- Recommendations: If reporting events are used for compliance/financial audit downstream (billing, admissions), add a dead-letter/retry mechanism or alerting on repeated publish failures rather than log-only; confirm this is an accepted tradeoff for the archiver design in `new/docs/superpowers/plans/2026-08-01-reporting-archiver.md`.

**Multi-tenant DB credentials default to hardcoded values when env vars are unset:**
- Risk: `createDataSource()` falls back to `identity_access` / `identity_access_dev_password` literals baked into source when `DB_USERNAME`/`DB_PASSWORD` are not set.
- Files: `new/code/apps/api/src/database/data-source.ts:49-52`
- Current mitigation: Presumably overridden via env vars in every real deployment (`docker-compose.dev.yml`).
- Recommendations: Fine for local dev; verify CI/prod deployment configs always set these explicitly and consider failing fast (throw) instead of silently defaulting to a known password when `NODE_ENV=production`.

**Tenant ID validated by regex before being used in dynamic SQL/schema operations:**
- Files: `new/code/apps/api/src/accounts/accounts.service.ts:25,55`
- Current mitigation: `SAFE_TENANT_ID = /^[a-z0-9_]+$/` guards against injection via tenant identifier before it's interpolated into schema-qualified queries — good practice already in place, flagged here only so any *new* dynamic-SQL code path in this module reuses the same guard rather than re-implementing tenant ID validation.

## Performance Bottlenecks

**Reporting subscriber does synchronous per-row work inside `afterInsert`:**
- Problem: For `Order` inserts, `buildPayload` issues an additional `event.manager.find(OrderItem, ...)` query synchronously inside the same transaction/event hook before the insert transaction can complete its `afterInsert` phase.
- Files: `new/code/apps/api/src/reporting/reporting.subscriber.ts:29-38`
- Cause: EntitySubscriber hooks run inline with the ORM's unit-of-work; every order insert now pays the cost of one extra query plus a reporting-event insert (`publisher.publish`) before the original transaction can finish.
- Improvement path: Acceptable at current scale; if order volume grows, consider moving payload enrichment to an async outbox worker rather than doing it inline in `afterInsert`.

## Fragile Areas

**`accounts.service.ts` and `data-source.ts` both hardcode the full migration list — verified out of sync risk:**
- Files: `new/code/apps/api/src/accounts/accounts.service.ts:5-23,69-92`, `new/code/apps/api/src/database/data-source.ts:8-46`
- Why fragile: Two independent lists of the same migrations must be kept in lockstep by hand; nothing in the type system enforces this. See Tech Debt section above for the specific instance.
- Safe modification: When adding a new migration, update both files in the same commit and add an integration test asserting a newly provisioned tenant schema matches `information_schema` expectations for all tables.
- Test coverage: `accounts.service.integration-spec.ts` exists (278 lines) — confirm it asserts on the full expected table set, not just a subset, so a future omission is caught automatically.

**Reporting event catalog centralizes cross-module entity knowledge in one file:**
- Files: `new/code/apps/api/src/reporting/reporting.subscriber.ts:16-105`
- Why fragile: `ReportingSubscriber` imports and knows about entities from `orders`, `billing`, and `admissions` modules directly, creating implicit coupling — any entity rename/field rename in those modules silently breaks reporting payloads only caught by tests or runtime errors logged (not surfaced).
- Safe modification: When renaming fields on `Order`, `Invoice`, `Payment`, `Deposit`, `Admission`, or `BedTransfer`, grep this file explicitly before merging.
- Test coverage: `persisting-reporting-event-publisher.integration-spec.ts` (233 lines, currently untracked/new) covers the publisher; confirm it also exercises each entity branch in the catalog `Map`, not just one.

## Scaling Limits

Not assessed — no load-testing artifacts, capacity docs, or connection-pool tuning found in this pass. Revisit once traffic/volume assumptions are documented (see `new/docs/technical-design/`).

## Dependencies at Risk

Not detected — package manifest review not performed in this pass (concerns focus prioritized source-code risk signals). Run a dedicated CVE/dependency audit (`cve-scan` skill) for a full picture.

## Missing Critical Features

Not assessed in this pass — feature completeness is tracked in `new/docs/superpowers/plans/` and `.planning/`, not evaluated here.

## Test Coverage Gaps

**Reporting subscriber error path is untested:**
- What's not tested: The `catch` block in `ReportingSubscriber.afterInsert` (log-and-swallow on publish failure) — no test found that forces `publisher.publish` to throw and asserts the parent transaction still succeeds.
- Files: `new/code/apps/api/src/reporting/reporting.subscriber.ts:134-142`
- Risk: A regression that turns "log and continue" into "log and rethrow" (breaking the triggering business transaction) could ship undetected.
- Priority: Medium — directly affects order/billing/admission write paths since the subscriber attaches to all of them.

**Migration-list parity between `accounts.service.ts` and `data-source.ts` is untested:**
- What's not tested: No test found asserting the migration array in `AccountsService` (tenant provisioning) matches the migration array in `createDataSource()`.
- Files: `new/code/apps/api/src/accounts/accounts.service.ts`, `new/code/apps/api/src/database/data-source.ts`
- Risk: Silent tenant schema drift, as described in Tech Debt.
- Priority: High — directly causes broken tenant provisioning with no error surfaced.

---

*Concerns audit: 2026-08-01*
