# Structured Logging — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 3 item 6 (`new-features.md` #10)
**Scope:** structured logging only. `new-features.md` #10 also names a Prometheus metrics
endpoint, OpenTelemetry tracing, and Grafana/Loki dashboards+alerts — those are explicitly deferred
to a follow-up item (see Non-goals) at the human partner's request, to prioritize a prototype demo.

## Problem

The application has no structured logging today — NestJS's default `Logger` writes plain-text
lines to stdout with no machine-parseable fields, no correlation ID, and no tenant ID. That makes
production debugging across concurrent tenant requests impractical (PRD §10 Non-Functional
Requirements calls out "centralized logs" as a requirement), and it's the prerequisite the PRD's
full observability stack (metrics, tracing, Loki ingestion) will eventually build on.

The pieces already exist to make this cheap:

- `TenantContextService` (`libs/tenant-context`) already tracks `tenantId`, `accountId`, and
  `correlationId` per request via `AsyncLocalStorage`, set by `TenantContextMiddleware`
  (`libs/tenant-context/src/lib/tenant-context.middleware.ts:21-25`) — `correlationId` comes from
  an inbound `x-correlation-id` header or a generated UUID, and `.run()` wraps the rest of the
  request's middleware/handler chain, so the context is live for the whole request.
- No logging library is installed yet (`grep` for `pino`/`winston`/`nestjs-pino` in
  `apps/api/package.json` and the workspace root returns nothing) — this is a clean build, not a
  migration.

## Decisions

- **`nestjs-pino` + `pino`.** Fastest JSON logger for Node, drop-in NestJS `Logger` replacement
  (existing `new Logger(...)` call sites across the codebase — e.g. `AuditSubscriber`,
  `PersistingAuditEventPublisher` — keep working unchanged once `app.useLogger()` is wired), and
  ships an HTTP request/response auto-logger (`pino-http`) for free.
- **New `libs/observability` lib**, matching this repo's existing pattern for cross-cutting
  concerns (`@hospital/tenant-context`, `@hospital/auth-guards`, `@hospital/audit-emitter`).
  Exports one `ObservabilityLoggerModule` (wraps `LoggerModule.forRoot(...)` from `nestjs-pino`
  with this repo's fixed config) so `AppModule` only ever imports one thing. Depends on
  `@hospital/tenant-context` (needs `TenantContextService`'s `AsyncLocalStorage` accessor) — same
  dependency direction `@hospital/audit-emitter` already has today, so no new inter-lib rule is
  needed in the Nx module-boundary config.
- **Context propagation via a pino `mixin`, not `pinoHttp.customProps`.** A `mixin` function runs
  on *every* log call the pino instance makes — the automatic HTTP request-completion line and any
  explicit `logger.log()`/`.warn()`/`.error()` call anywhere in the app — because it's a core pino
  option, not specific to `pino-http`'s request-scoped wrapper. This sidesteps needing to reason
  about NestJS middleware registration order between `TenantContextMiddleware` (registered in
  `AppModule.configure()`) and whatever middleware `nestjs-pino`'s `LoggerModule` registers
  internally: the mixin just reads `TenantContextService`'s `AsyncLocalStorage.getStore()`
  directly at log time, synchronously, no DI needed inside the mixin itself. As long as a log call
  happens anywhere within the async chain `TenantContextMiddleware.use()` kicked off via
  `tenantContext.run({...}, () => next())`, the mixin sees `tenantId`/`accountId`/`correlationId`;
  outside a request (app bootstrap, background code with no tenant context) the mixin returns `{}`
  and those fields are simply absent from the line.
- **Redaction: fixed key-path list via pino's `redact` option**, covering known-sensitive fields
  wherever they appear in a logged object: `password`, `token`, `refreshToken`, `authorization`
  (and `req.headers.authorization`/`req.headers.cookie` specifically, since `pino-http` logs
  request headers by default), `ssn`, `dob`, `diagnosis`, `phone`, `email`, `address`. This is a
  backstop, not the primary defense — the primary defense is a documented code convention (added to
  `Development-Standards.md`): **log specific fields/IDs, never a whole entity object.** A
  `logger.log({ patientId: patient.id }, 'admitted')` can't leak PHI through a field that isn't on
  the redact list; `logger.log(patient)` could.
- **Config:**
  - `LOG_LEVEL` env var, default `'debug'` when `NODE_ENV !== 'production'` else `'info'`.
  - Dev/local: `pino-pretty` transport (human-readable, colorized) when `NODE_ENV !== 'production'`.
  - Production: plain JSON to stdout (no transport) — this is what a future Loki/Promtail sidecar
    will scrape; no code change needed when that lands, only infra.
  - Test (`NODE_ENV === 'test'`, which Jest sets automatically): level forced to `'silent'` so test
    output stays readable. Configured once in `ObservabilityLoggerModule`, not per-spec.
- **Wiring in `main.ts`:** `NestFactory.create(AppModule, { bufferLogs: true })`, then
  `app.useLogger(app.get(Logger))` (the `nestjs-pino` `Logger`) before any other bootstrap logging
  call — `bufferLogs: true` prevents the default Nest logger from emitting bootstrap-phase logs
  before the pino logger takes over.

## Non-goals

- Prometheus metrics endpoint, OpenTelemetry tracing, Grafana dashboards, Loki deployment — all of
  `new-features.md` #10 beyond structured logging. Tracked as a separate follow-up in
  `pending-tasks.md` Phase 3 once this lands (structured JSON logs are also the prerequisite Loki
  ingestion needs, so this isn't wasted work).
- TypeORM query-level logging. Out of scope — noisy, not asked for by the PRD's observability NFR,
  and a different concern (query performance debugging) than request/operation-level structured
  logs.
- Automated PHI-leak scanning/linting of log call sites. The redact list + documented convention is
  the agreed bar for this pass; a lint rule enforcing "no whole-entity logging" is a possible
  future hardening step, not built here.
- Replacing every existing ad hoc `console.log`/`new Logger(...)` call site's *content* — those
  keep working via `app.useLogger()` without edits. Only new code is expected to follow the
  specific-fields convention going forward; a sweep of existing call sites for entity-object logging
  is not part of this task.

## Testing

- One integration test (in `apps/api/src/app`, alongside existing app-level specs) making a real
  HTTP request through the app and asserting the emitted log line for that request contains the
  expected `tenantId` and `correlationId` (captured via a pino stream override during the test, not
  by parsing stdout).
- One test asserting a redacted key (e.g. `password`) never appears in emitted log output when
  logged as part of an object — proves the `redact` config is wired, not just declared.
- Existing suite (`nx run-many -t typecheck test`) must stay green — `app.useLogger()` swaps the
  logger implementation but every existing `Logger.log/warn/error/debug` call site keeps the same
  call signature, so no other spec should need changes.
