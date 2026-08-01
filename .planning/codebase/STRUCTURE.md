# Codebase Structure

**Analysis Date:** 2026-08-01

## Directory Layout

```
new_hospital/                              # git repo root
├── new/                                   # active greenfield re-platform
│   ├── code/                              # Nx monorepo (pnpm workspaces)
│   │   ├── apps/
│   │   │   └── api/                       # single NestJS application
│   │   │       └── src/
│   │   │           ├── main.ts            # bootstrap entry point
│   │   │           ├── app/               # AppModule (root wiring)
│   │   │           ├── accounts/          # account/user management
│   │   │           ├── admissions/        # bed/ward admissions
│   │   │           ├── appointments/      # scheduling
│   │   │           ├── assets/            # static/misc assets module
│   │   │           ├── audit/             # audit record persistence + wiring
│   │   │           ├── auth/              # login/auth
│   │   │           ├── billing/           # invoices, payments, deposits
│   │   │           ├── clinical/          # sub-domain: vitals/, encounters/, triage/
│   │   │           ├── database/          # DataSource, migrations, tenant connection
│   │   │           ├── master-data/       # reference/lookup data
│   │   │           ├── orders/            # clinical orders + order items
│   │   │           ├── patients/          # patient records
│   │   │           ├── rbac/              # roles/permissions entities + seed script
│   │   │           ├── reporting/         # reporting event capture (subscriber+publisher)
│   │   │           └── tenants/           # tenant/hospital records
│   │   ├── libs/                          # shared Nx libraries (@hospital/*)
│   │   │   ├── audit-emitter/             # AuditSubscriber, diff builder, exclude decorator
│   │   │   ├── auth-guards/               # PermissionGuard, RequirePermission decorator
│   │   │   └── tenant-context/            # TenantContextMiddleware/Service/Module
│   │   ├── packages/                      # (present, not yet populated with app code)
│   │   ├── .agents/ .cursor/ .codex/ ...  # per-tool AI agent config mirrors
│   │   ├── package.json                   # workspace root manifest
│   │   ├── pnpm-workspace.yaml
│   │   └── CLAUDE.md                      # Nx + project conventions (read this first)
│   └── docs/
│       ├── architecture-decision-records/ # ADRs
│       ├── technical-design/              # design docs
│       └── superpowers/                   # plans/ and specs/ for phased feature work
├── old/
│   └── hospital-management-emr/           # legacy .NET ("Danphe EMR") codebase — reference only
├── .planning/                             # GSD planning artifacts (this document lives here)
├── .superpowers/                          # superpowers skill working directory (SDD plans)
└── .claude/                               # Claude Code config, worktrees
```

## Directory Purposes

**`new/code/apps/api/src/<feature>/`:**
- Purpose: one bounded-context slice per domain area (accounts, admissions, appointments, auth, billing, clinical, master-data, orders, patients, rbac, reporting, tenants)
- Contains: `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/*.dto.ts`, `entities/*.entity.ts`, `*.integration-spec.ts`
- Key files: e.g. `orders/orders.module.ts`, `orders/orders.controller.ts`, `orders/orders.service.ts`

**`new/code/apps/api/src/clinical/`:**
- Purpose: groups three closely related clinical sub-features under one parent directory instead of flattening them at `src/` top level
- Contains: `vitals/`, `encounters/`, `triage/` — each with its own module/controller/service/dto/entities, same shape as top-level features

**`new/code/apps/api/src/database/`:**
- Purpose: cross-feature persistence infrastructure, not a feature module itself
- Contains: `data-source.ts` (TypeORM config), `database.module.ts` (`@Global()` DataSource + TenantConnectionService provider), `tenant-connection.service.ts` (schema-per-tenant query execution), `migrate.ts` (migration runner script), `migrations/NNNN-<description>.ts` (numbered, sequential)

**`new/code/libs/<name>/`:**
- Purpose: Nx library, importable workspace-wide as `@hospital/<name>` (per `pnpm-workspace.yaml` `packages: [libs/*]`)
- Contains: `src/index.ts` (barrel export), `src/lib/*.ts` implementation + co-located `*.spec.ts`, `package.json` declaring `"type": "module"`, `tsconfig*.json`, `jest.config.cts`
- Key files: `tenant-context/src/lib/tenant-context.{middleware,service,module}.ts`, `auth-guards/src/lib/{permission.guard,require-permission.decorator,request-context}.ts`, `audit-emitter/src/lib/{audit.subscriber,build-audit-diff,audit-exclude.decorator,audit-event-publisher.interface}.ts`

**`new/docs/`:**
- Purpose: architecture decision records, technical design docs, and superpowers-managed phase plans/specs
- Contains: `architecture-decision-records/`, `technical-design/`, `superpowers/plans/*.md`, `superpowers/specs/*.md`

**`old/hospital-management-emr/`:**
- Purpose: legacy .NET EMR codebase, kept as a reference for behavior parity, not built or run as part of the new stack
- Contains: `Code/` (Components, Solutions, Utilities, Websites), `Database/` (Admin-Db, EMR-Db scripts)

## Key File Locations

**Entry Points:**
- `new/code/apps/api/src/main.ts`: NestFactory bootstrap, global prefix `api`, Swagger UI at `/api/docs`
- `new/code/apps/api/src/app/app.module.ts`: root module importing all feature modules, applies tenant middleware globally

**Configuration:**
- `new/code/package.json`: workspace root dependencies/devDependencies (Nx, Jest, TypeORM, NestJS)
- `new/code/pnpm-workspace.yaml`: workspace package globs (`apps/*`, `libs/*`)
- `new/code/apps/api/src/database/data-source.ts`: TypeORM `DataSource` factory/config
- `tsconfig.base.json` (protected/guarded file — see `new/code/CLAUDE.md`): `module`/`moduleResolution: nodenext`, requires explicit `.js` extensions on relative imports

**Core Logic:**
- `new/code/apps/api/src/database/tenant-connection.service.ts`: schema-per-tenant query execution — the seam every feature service goes through
- `new/code/libs/tenant-context/src/lib/tenant-context.service.ts`: AsyncLocalStorage-backed request context
- `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts` + `new/code/apps/api/src/reporting/reporting.subscriber.ts`: cross-cutting write-side projections

**Testing:**
- `*.integration-spec.ts` co-located next to the code under test (e.g. `apps/api/src/orders/orders.controller.integration-spec.ts`, `apps/api/src/orders/orders.service.integration-spec.ts`)
- `*.spec.ts` co-located for unit-level lib tests (e.g. `libs/auth-guards/src/lib/permission.guard.spec.ts`)

## Naming Conventions

**Files:**
- `<feature>.module.ts` / `<feature>.controller.ts` / `<feature>.service.ts` — kebab-case, NestJS suffix convention
- `<name>.entity.ts` under `entities/` subdirectory per feature
- `<name>.dto.ts` under `dto/` subdirectory per feature
- `<name>.spec.ts` for unit tests, `<name>.integration-spec.ts` for integration tests, both co-located with the file under test
- Migrations: `NNNN-create-<description>-tables.ts` or `NNNN_create_<description>_tables.ts` (two separator styles coexist — hyphen is the dominant/current style; `005_create_patient_tables.ts` and `0011_create_encounter_tables.ts` are underscore outliers)

**Directories:**
- Singular-domain-noun, plural for collections of records: `patients/`, `orders/`, `admissions/`, `tenants/`, `accounts/` — but `clinical/` is a grouping directory (not itself a module) containing `vitals/`, `encounters/`, `triage/`
- Shared libs are named for their capability, not their consumer: `tenant-context`, `auth-guards`, `audit-emitter`

## Where to Add New Code

**New Feature (bounded context):**
- Create `new/code/apps/api/src/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, `dto/`, `entities/`
- Register the new module in `imports: [...]` of `new/code/apps/api/src/app/app.module.ts`
- Add a numbered migration in `new/code/apps/api/src/database/migrations/` for any new tables
- Tests: co-locate `<feature>.controller.integration-spec.ts` and `<feature>.service.integration-spec.ts` next to the source files

**New Sub-feature under an existing grouping (e.g. clinical):**
- Follow the `clinical/vitals`, `clinical/encounters`, `clinical/triage` pattern — one directory per sub-feature under the grouping directory, each with its own module/controller/service/dto/entities

**Cross-feature/shared infrastructure:**
- Add a new Nx library under `new/code/libs/<name>/` via the Nx generator (see `new/code/CLAUDE.md` — invoke the `nx-generate` skill first)
- Export via `src/index.ts` barrel, consume elsewhere as `@hospital/<name>` after adding `"@hospital/<name>": "workspace:*"` to the consuming package's `package.json`
- Delete generator scaffold placeholder files once real implementation exists

**Entity subscriber for a new cross-cutting concern (audit-like/reporting-like):**
- Model after `new/code/apps/api/src/reporting/reporting.subscriber.ts` (per-app, feature-aware) or `new/code/libs/audit-emitter/src/lib/audit.subscriber.ts` (generic, lib-level) depending on whether the concern needs feature-specific entity knowledge
- Publisher implementations that persist derived events must accept the in-flight `EntityManager` so the write joins the same transaction as the triggering change

## Special Directories

**`new/code/apps/api/dist/`, `new/code/apps/api/out-tsc/`, `libs/*/dist/`, `libs/*/out-tsc/`:**
- Purpose: build/test output
- Generated: Yes
- Committed: No (build artifacts)

**`new/code/.nx/cache`, `new/code/.nx/workspace-data`:**
- Purpose: Nx task-graph/build cache
- Generated: Yes
- Committed: No

**`new/code/node_modules`, `new/code/apps/api/node_modules`:**
- Purpose: installed dependencies (pnpm)
- Generated: Yes
- Committed: No

**`old/hospital-management-emr/`:**
- Purpose: legacy source of truth for existing behavior during re-platform; not part of the buildable Nx workspace
- Generated: No
- Committed: Yes (reference only — do not wire into `new/code` build)

**`.claude/worktrees/`:**
- Purpose: isolated git worktrees for in-flight feature branches (e.g. `feat-order`, `feat-reporting-archiver`), each a full checkout of `new/`
- Generated: Yes (via git worktree)
- Committed: No

---

*Structure analysis: 2026-08-01*
