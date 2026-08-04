# Connection Pooling and Tenant Limits — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 3 item 7 (`new-features.md` #9)
**Scope:** global pool size cap + statement timeout on the main `DataSource` only. Per-tenant
connection caps and tenant-tagged metrics/alerts — the other two `new-features.md` #9 asks — are
explicitly deferred (see Non-goals).

## Problem

`new-features.md` #9 asks for four things: global and per-tenant connection caps, statement
timeouts for expensive queries, query metrics tagged by tenant, and alerts for noisy-neighbor
behavior. The prior reporting-archiver session (commits `5efd9d6`/`14dec3c`/`22db6ed`) already
bounded `connectionTimeoutMillis` on both the main `DataSource` (`apps/api/src/database/data-source.ts`)
and gave reporting writes their own dedicated 3-connection pool
(`apps/api/src/database/reporting-data-source.ts`) — but neither pool has an explicit `max` size
(both fall back to node-postgres's implicit default of 10 for the main pool; reporting is
explicitly capped at 3) or a `statement_timeout`, and nothing in the codebase enforces a per-tenant
cap or emits tenant-tagged query metrics.

Two of the four asks depend on infrastructure that doesn't exist yet and is out of scope here:

- **Tenant-tagged metrics + noisy-neighbor alerts** need the Prometheus/Grafana stack explicitly
  deferred out of Phase 3 item 6 (structured-logging-only pass, see
  `new/docs/superpowers/specs/2026-08-04-structured-logging-design.md`).
- **True per-tenant connection caps** (`new-features.md` #9 literally says "PgBouncer or
  equivalent") mean a new proxy process — real production infrastructure this repo doesn't have
  yet (there's no production Dockerfile or production `docker-compose.yml` either, a gap already
  tracked in `Deployment-Guide.md`/`pending-tasks.md`'s dependencies section from Phase 2 item 5).

## Decisions

- **`DB_POOL_MAX` env var, default `20`**, set as `extra.max` on the main `DataSource`
  (`createDataSource()` in `apps/api/src/database/data-source.ts`). Replaces node-postgres's
  implicit default of 10 with an explicit, tunable value. `20` is a reasonable placeholder given
  the PRD's own reference-server sizing is still an open question pending a real load test
  (`PRD.md` §12 open question #1) — not a measured number, but explicit and env-tunable so the
  eventual load test can change it without a code change.
- **`DB_STATEMENT_TIMEOUT_MS` env var, default `30000` (30s)**, set as `extra.statement_timeout` on
  the main `DataSource`. node-postgres's `Pool`/`Client` config accepts `statement_timeout` as a
  first-class option (milliseconds) and issues `SET statement_timeout` itself right after
  connecting — no workaround needed, unlike the `search_path` connection-option trick
  `tenant-migration-data-source.ts` needed elsewhere (that trick exists because `search_path` has
  no first-class `pg` option; `statement_timeout` does).
- **Reporting pool untouched.** `createReportingDataSource()` keeps its existing
  `connectionTimeoutMillis: 2000`/`max: 3`. It only ever does simple single-table inserts inside a
  fire-and-forget try/catch (`PersistingReportingEventPublisher`) — a statement timeout adds
  nothing there, and its pool size is already deliberately small and separate from the main pool.
- **Verification is manual, not an automated test.** Consistent with this session's deferred-testing
  pattern (structured logging, tenant-isolation's Task 7): start the app, confirm the configured
  value via `SHOW statement_timeout;` in a live session against the dev database, and/or run a
  deliberately slow query (e.g. `pg_sleep`) through the app's connection and confirm Postgres
  cancels it with a `query_canceled` error once `DB_STATEMENT_TIMEOUT_MS` elapses.

## Non-goals

- **Per-tenant connection caps.** Requires PgBouncer or an equivalent proxy — new production
  infrastructure, not a `DataSource` config change. Grouped into the existing
  production-infra/PgBouncer follow-up already noted in `pending-tasks.md`'s dependencies section
  (alongside the missing production Dockerfile/`docker-compose.yml`), not solved here.
- **Query metrics tagged by tenant, alerts for noisy-neighbor behavior.** Both need the
  Prometheus/Grafana/alerting stack deferred out of Phase 3 item 6. Tracked as part of that same
  future observability follow-up, not duplicated here.
- **Tuning the actual `DB_POOL_MAX`/`DB_STATEMENT_TIMEOUT_MS` default values against real load.**
  That's exactly what `pending-tasks.md` Phase 3 item 9 (reference server sizing + load test) is
  for — this task only makes the values explicit and configurable, it doesn't validate them.

## Testing

- Manual verification only (see Decisions above) — no automated test added, per this session's
  deferred-testing directive.
- Existing suite (`nx run-many -t typecheck test`) must stay green — this is an additive config
  change to `createDataSource()`'s `extra` object; no existing behavior changes when the new env
  vars are unset (defaults preserve current behavior other than the explicit `max`, which only
  raises the effective cap from node-postgres's implicit 10 to 20 — never lower than what the
  existing suite already exercises).
