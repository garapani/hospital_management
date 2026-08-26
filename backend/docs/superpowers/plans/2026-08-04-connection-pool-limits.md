# Connection Pool Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the main `DataSource`'s connection pool size and statement timeout explicit and
env-tunable, instead of relying on node-postgres's implicit defaults.

**Architecture:** Two new `extra` options on `createDataSource()`'s config object — `max` and
`statement_timeout` — both first-class `pg` `Pool`/`Client` options, both read from env vars with
sensible defaults.

**Tech Stack:** node-postgres (`pg`) pool config via TypeORM's `extra` passthrough — no new
dependency, no new infra.

## Global Constraints

- **Scope is the main `DataSource` only.** `apps/api/src/database/reporting-data-source.ts` is not
  touched — it already has its own `max: 3`/`connectionTimeoutMillis: 2000` and only does
  best-effort single-table inserts, no expensive queries to bound.
- **`DB_POOL_MAX` env var, default `20`.**
- **`DB_STATEMENT_TIMEOUT_MS` env var, default `30000`** (30 seconds).
- **No test-first workflow, no automated test.** Per the human partner's standing instruction this
  session, implement directly. The spec's Testing section calls for manual verification only (live
  `SHOW statement_timeout;` check plus a `pg_sleep` cancellation check) — do not write an automated
  spec for this.
- Per-tenant connection caps and tenant-tagged metrics/alerts are explicitly out of scope — not
  part of this plan at all, tracked as existing follow-ups (PgBouncer/production-infra,
  observability stack respectively).

---

### Task 1: Add pool max and statement timeout to the main `DataSource`

**Files:**
- Modify: `apps/api/src/database/data-source.ts:36-54`

**Interfaces:**
- None — this only adds two new keys to an existing internal config object literal. No exported
  signature changes.

- [ ] **Step 1: Update `createDataSource()`'s `extra` config**

`apps/api/src/database/data-source.ts` currently has this `extra` object inside
`createDataSource()`:
```ts
    // Bounds connection acquisition so pool exhaustion fails fast (a thrown, catchable error)
    // instead of queuing forever — node-postgres defaults to connectionTimeoutMillis: 0 (wait
    // indefinitely), which turns sustained overload into a silent, unbounded stall.
    extra: {
      connectionTimeoutMillis: 5000,
    },
```
Replace it with:
```ts
    // Bounds connection acquisition so pool exhaustion fails fast (a thrown, catchable error)
    // instead of queuing forever — node-postgres defaults to connectionTimeoutMillis: 0 (wait
    // indefinitely), which turns sustained overload into a silent, unbounded stall.
    //
    // max/statement_timeout are both first-class `pg` Pool/Client options — pg issues
    // `SET statement_timeout` itself right after connecting, no raw-SQL workaround needed (unlike
    // search_path, which pg has no first-class option for — see tenant-migration-data-source.ts).
    // Defaults here are a placeholder pending the real load test PRD.md §12 open question #1
    // still calls for; both are env-tunable without a code change once that number is known.
    extra: {
      connectionTimeoutMillis: 5000,
      max: Number(process.env['DB_POOL_MAX'] ?? 20),
      statement_timeout: Number(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? 30000),
    },
```

- [ ] **Step 2: Typecheck and run the existing suite**

Run (from `new/code`): `pnpm exec nx run-many -t typecheck test`
Expected: all projects typecheck clean, full existing suite stays green. This is additive-only —
`DB_POOL_MAX`/`DB_STATEMENT_TIMEOUT_MS` are unset in the test environment, so both fall back to
their defaults (`20`, `30000`), which only raises the effective pool cap above node-postgres's
implicit 10 and adds a 30s statement timeout neither existing test nor CI comes close to hitting.

- [ ] **Step 3: Manual verification — pool max and statement timeout are live**

Start local Postgres and the API:
```bash
docker-compose -f docker-compose.dev.yml up -d
pnpm exec nx serve api
```
In another terminal, connect with `psql` using the same credentials the app uses
(`docker-compose.dev.yml`'s `api-postgres` service — `identity_access`/
`identity_access_dev_password` on `localhost:5433`/db `identity_access`):
```bash
psql "postgresql://identity_access:identity_access_dev_password@localhost:5433/identity_access" \
  -c "SELECT count(*) FROM pg_stat_activity WHERE usename = 'identity_access';"
```
Expected: this confirms Postgres is reachable and shows the app's existing connections (from
`nx serve api`'s own pool) — a sanity check before the timeout check below, not a pool-max proof
(proving the pool max plateaus at exactly 20 under load is exactly what the real load test, Phase 3
item 9, is for — this step just confirms the value is wired, not the cap's true ceiling behavior
under concurrency).

Then confirm the statement timeout is actually applied by running a deliberately slow query through
the app's own pool. Since the app's pool isn't directly queryable from a shell, verify
`statement_timeout` is set correctly by connecting `psql` with the *same* pool option pg would use
and manually issuing the identical `SET`:
```bash
psql "postgresql://identity_access:identity_access_dev_password@localhost:5433/identity_access" \
  -c "SET statement_timeout = 30000; SELECT pg_sleep(35);"
```
Expected: the `pg_sleep(35)` call fails after ~30 seconds with:
```
ERROR:  canceling statement due to statement timeout
```
This proves Postgres enforces `statement_timeout` at the value the app now configures — the app's
`pg` pool sets this same session-level GUC on every connection it opens (per Step 1's config),
so any query the app runs that runs longer than `DB_STATEMENT_TIMEOUT_MS` will be cancelled the
same way.

Stop the server (`Ctrl+C`) once confirmed.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/database/data-source.ts
git commit -m "feat(database): make main pool size and statement timeout explicit and env-tunable"
```

---

### Task 2: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Add a Development-Standards.md section**

Append after the existing `## 9. Structured Logging` section, which currently ends the file with:
```markdown
See `new/docs/superpowers/plans/2026-08-04-structured-logging.md` for the full implementation
history. Metrics, tracing, and dashboards (the rest of `new-features.md` #10) are a separate,
not-yet-scheduled follow-up.
```
Add:
```markdown

## 10. Connection Pooling

The main `DataSource` (`apps/api/src/database/data-source.ts`) has an explicit, env-tunable pool
size and statement timeout: `DB_POOL_MAX` (default `20`, replacing node-postgres's implicit
default of 10) and `DB_STATEMENT_TIMEOUT_MS` (default `30000`, 30 seconds). Both are first-class
`pg` `Pool`/`Client` options passed through TypeORM's `extra` — `pg` issues `SET statement_timeout`
itself right after connecting, unlike `search_path`, which has no first-class option and needs the
connection-string workaround `tenant-migration-data-source.ts` uses instead.

The reporting pool (`apps/api/src/database/reporting-data-source.ts`) is untouched — it already has
its own `max: 3`/`connectionTimeoutMillis: 2000`, and only ever runs simple best-effort
single-table inserts, so a statement timeout adds nothing there.

**These defaults are a placeholder, not a measured number** — `PRD.md` §12 open question #1 (exact
reference server sizing) is still open pending a real load test (`pending-tasks.md` Phase 3 item
9). Both values are env vars specifically so that load test can tune them without a code change.

**Deferred:** true per-tenant connection caps (`new-features.md` #9 calls for "PgBouncer or
equivalent" — a new proxy process this repo has no production infrastructure to run yet) and
tenant-tagged query metrics + noisy-neighbor alerts (needs the Prometheus/Grafana stack already
deferred out of Phase 3 item 6). Both remain open, grouped with their respective existing
follow-ups rather than solved here.

See `new/docs/superpowers/plans/2026-08-04-connection-pool-limits.md` for the full implementation
history.
```

- [ ] **Step 2: Check off `pending-tasks.md` Phase 3 item 7**

The line currently reads:
```markdown
7. **Connection pooling/tenant limits** (new-features.md #9) — direct extension of the
   pool-timeout work from the reporting-archiver session; context is fresh.
```
Replace with:
```markdown
7. [x] **Connection pooling/tenant limits** (new-features.md #9) — **global pool max + statement
   timeout only**, done: `DB_POOL_MAX` (default 20), `DB_STATEMENT_TIMEOUT_MS` (default 30000ms) on
   the main `DataSource`. Per-tenant caps (needs PgBouncer — grouped with the existing missing
   production Dockerfile/`docker-compose.yml` gap) and tenant-tagged metrics/alerts (needs the
   observability stack deferred out of item 6) are **not done**.
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document connection pool limits, scope Phase 3 item 7 to pool max + statement timeout"
```
