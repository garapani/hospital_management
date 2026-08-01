# External Integrations

**Analysis Date:** 2026-08-01

## APIs & External Services

**None detected.** No third-party SaaS/API SDKs (payment, messaging, email, SMS, etc.) found in `new/code/package.json` dependencies or source imports. The system is currently a self-contained NestJS API with no outbound external API calls identified.

## Data Storage

**Databases:**
- PostgreSQL 16 (single relational database)
  - Connection: configured via env vars `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` in `new/code/apps/api/src/database/data-source.ts`
  - Dev instance: `new/code/docker-compose.dev.yml` (`postgres:16-alpine`, host port 5433 → container 5432, default dev credentials `identity_access` / `identity_access_dev_password`, default db `identity_access`)
  - Client/ORM: TypeORM (`new/code/apps/api/src/database/data-source.ts`), migrations tracked under `new/code/apps/api/src/database/migrations/` (17 migrations covering RBAC, tenants, patients, vitals, triage, beds, admissions, orders, billing, reporting)
  - Multi-tenancy: per-tenant DB connection handling in `new/code/apps/api/src/database/tenant-connection.service.ts`, tenant context propagated via `libs/tenant-context` (`new/code/libs/tenant-context/src/lib/tenant-context.service.ts`, `tenant-context.middleware.ts`, `tenant-context.module.ts`)

**File Storage:**
- None detected. `new/code/apps/api/src/assets/` exists but only contains a `.gitkeep` placeholder — no storage integration wired up.

**Caching:**
- None detected.

## Authentication & Identity

**Auth Provider:**
- Custom, in-house (no external IdP/OAuth provider)
  - Implementation: `new/code/apps/api/src/auth/auth.module.ts`, `auth.service.ts`, `auth.controller.ts`
  - JWT issuance/verification via `@nestjs/jwt`, secret from `JWT_SECRET` env var (defaults to an insecure hardcoded dev value — see `new/code/apps/api/src/auth/auth.module.ts:14`)
  - Password hashing via `bcryptjs`
  - Permission/role enforcement: `libs/auth-guards` (`new/code/libs/auth-guards/src/lib/permission.guard.ts`, `require-permission.decorator.ts`, `request-context.ts`)
  - RBAC catalog (roles/permissions) seeded via `new/code/apps/api/src/rbac/seed-rbac-catalog.ts`, entities in `new/code/apps/api/src/rbac/entities/`
  - Cross-tenant login handling tested in `new/code/apps/api/src/auth/cross-tenant-login.integration-spec.ts`

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry/Datadog/etc. SDK in dependencies).

**Logs:**
- NestJS built-in `Logger` (`@nestjs/common`), used in `new/code/apps/api/src/main.ts` for startup logging. No structured logging or external log shipping detected.

## CI/CD & Deployment

**Hosting:**
- Not yet defined. No Dockerfile for the API app or deployment manifests detected (only `docker-compose.dev.yml` for local Postgres).

**CI Pipeline:**
- `new/code/.github` directory exists; contents not confirmed as an active CI pipeline in this pass — check `new/code/.github/workflows/` directly if CI behavior is needed.

## Environment Configuration

**Required env vars:**
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` — Postgres connection (`new/code/apps/api/src/database/data-source.ts`)
- `JWT_SECRET` — JWT signing secret (`new/code/apps/api/src/auth/auth.module.ts`)
- `PORT` — API listen port, defaults to 3000 (`new/code/apps/api/src/main.ts`)

**Secrets location:**
- No dedicated secrets manager or `.env` file detected in `new/code/`. Defaults are hardcoded fallbacks in source (dev-only values) — flag as a hardening item before production use.

## Webhooks & Callbacks

**Incoming:**
- None detected.

**Outgoing:**
- None detected. Internal event publishing exists but is in-process only:
  - `new/code/apps/api/src/audit/persisting-audit-event-publisher.ts` — persists audit events to the `AuditRecord` table (via `libs/audit-emitter`'s `audit.subscriber.ts`), not an external webhook.
  - `new/code/apps/api/src/reporting/persisting-reporting-event-publisher.ts` and `new/code/apps/api/src/reporting/reporting.subscriber.ts` — persists domain/business events to the `ReportingEvent` table for internal reporting/archival, also not external.

---

*Integration audit: 2026-08-01*
