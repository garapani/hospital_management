# Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the API structured, correlation/tenant-tagged JSON logs (via `nestjs-pino`), replacing
the unstructured default NestJS `Logger`, with a redaction backstop against accidental PHI leakage.

**Architecture:** A new `libs/observability` lib exports `ObservabilityLoggerModule`, which wraps
`nestjs-pino`'s `LoggerModule.forRootAsync` with a pino `mixin` hook that injects
`tenantId`/`accountId`/`correlationId` from `@hospital/tenant-context`'s `TenantContextService` into
every log line, plus a fixed-key `redact` list. `apps/api`'s `AppModule` imports it once; `main.ts`
swaps the bootstrap logger over to it.

**Tech Stack:** `nestjs-pino`, `pino`, `pino-http` (nestjs-pino's underlying HTTP auto-logger),
`pino-pretty` (dev-only transport).

## Global Constraints

- **Scope is structured logging only.** Prometheus metrics, OpenTelemetry tracing, and
  Grafana/Loki dashboards (also named in `new-features.md` #10) are explicitly out of scope for
  this plan — deferred to a separate future item.
- **No test-first workflow.** Per the human partner's standing instruction this session, implement
  directly; do not write failing tests before implementation. The spec's two named automated tests
  (HTTP log line carries tenantId/correlationId; a redacted key never appears in output) are
  **deferred** to the human partner's own post-prototype testing pass — do not write them as part
  of this plan. Each task substitutes a manual/runtime verification step instead.
- **Redact key list (exact, from the spec):** `password`, `token`, `refreshToken`, `authorization`,
  `req.headers.authorization`, `req.headers.cookie`, `ssn`, `dob`, `diagnosis`, `phone`, `email`,
  `address` — plus a `*.<key>` wildcard variant of each bare key name so it's caught one level
  into any logged object, not just at the log line's top level.
- **`LOG_LEVEL` env var**, default `'debug'` when `NODE_ENV !== 'production'`, else `'info'`; forced
  to `'silent'` when `NODE_ENV === 'test'` (Jest sets this automatically) regardless of `LOG_LEVEL`.
- **`pino-pretty` transport only when `NODE_ENV` is neither `'production'` nor `'test'`.** Plain
  JSON to stdout otherwise.
- Mixin reads context via **a `TenantContextService` instance injected once into the module
  factory** (`LoggerModule.forRootAsync({ inject: [TenantContextService], useFactory: ... })`), not
  a per-log-call DI lookup — the mixin closure just calls `.getTenantId()`/`.getAccountId()`/
  `.getCorrelationId()` on that captured instance on every invocation. This is simpler than reading
  the underlying `AsyncLocalStorage` directly and equally correct, since `TenantContextService` is
  a singleton provider and its `AsyncLocalStorage` is scoped to the running request regardless of
  when the service reference itself was obtained.
- New lib follows the exact scaffold shape of `libs/tenant-context` (package.json/tsconfig/jest
  config layout) per this repo's established lib-creation pattern.

---

### Task 1: `libs/observability` — `ObservabilityLoggerModule`

**Files:**
- Create: `libs/observability/package.json`
- Create: `libs/observability/tsconfig.json`
- Create: `libs/observability/tsconfig.lib.json`
- Create: `libs/observability/tsconfig.spec.json`
- Create: `libs/observability/jest.config.cts`
- Create: `libs/observability/.spec.swcrc`
- Create: `libs/observability/src/index.ts`
- Create: `libs/observability/src/lib/observability-logger.module.ts`

**Interfaces:**
- Produces: `ObservabilityLoggerModule` (a `@Module` class, no constructor args) — Task 2 imports
  it directly into `apps/api`'s `AppModule`.
- Consumes: `TenantContextService`, `TenantContextModule` from `@hospital/tenant-context` (already
  exists — `libs/tenant-context/src/index.ts`).

- [ ] **Step 1: Scaffold the lib's config files**

`libs/observability/package.json`:
```json
{
  "name": "@hospital/observability",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "nx": {
    "tags": ["type:platform-lib"]
  },
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "import": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@hospital/tenant-context": "workspace:*"
  }
}
```

`libs/observability/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "files": [],
  "include": [],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    },
    {
      "path": "./tsconfig.spec.json"
    }
  ]
}
```

`libs/observability/tsconfig.lib.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "tsBuildInfoFile": "dist/tsconfig.lib.tsbuildinfo",
    "emitDeclarationOnly": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "references": [
    {
      "path": "../tenant-context/tsconfig.lib.json"
    }
  ],
  "exclude": [
    "jest.config.ts",
    "jest.config.cts",
    "src/**/*.spec.ts",
    "src/**/*.test.ts"
  ]
}
```

`libs/observability/tsconfig.spec.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./out-tsc/jest",
    "types": ["jest", "node"],
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "jest.config.ts",
    "jest.config.cts",
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "src/**/*.d.ts"
  ],
  "references": [
    {
      "path": "./tsconfig.lib.json"
    }
  ]
}
```

`libs/observability/jest.config.cts`:
```ts
/* eslint-disable */
const { readFileSync } = require('fs');

// Reading the SWC compilation config for the spec files
const swcJestConfig = JSON.parse(
  readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
);

// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
swcJestConfig.swcrc = false;

module.exports = {
  displayName: '@hospital/observability',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
};
```

`libs/observability/.spec.swcrc`:
```json
{
  "jsc": {
    "target": "es2017",
    "parser": {
      "syntax": "typescript",
      "decorators": true,
      "dynamicImport": true
    },
    "transform": {
      "decoratorMetadata": true,
      "legacyDecorator": true
    },
    "keepClassNames": true,
    "externalHelpers": true,
    "loose": true
  },
  "module": {
    "type": "es6"
  },
  "sourceMaps": true,
  "exclude": []
}
```

- [ ] **Step 2: Write `ObservabilityLoggerModule`**

`libs/observability/src/lib/observability-logger.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { TenantContextModule, TenantContextService } from '@hospital/tenant-context';

const REDACT_PATHS = [
  'password',
  '*.password',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'ssn',
  '*.ssn',
  'dob',
  '*.dob',
  'diagnosis',
  '*.diagnosis',
  'phone',
  '*.phone',
  'email',
  '*.email',
  'address',
  '*.address',
];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [TenantContextModule],
      inject: [TenantContextService],
      useFactory: (tenantContext: TenantContextService) => {
        const nodeEnv = process.env['NODE_ENV'];
        const isProduction = nodeEnv === 'production';
        const isTest = nodeEnv === 'test';
        const level =
          process.env['LOG_LEVEL'] ?? (isTest ? 'silent' : isProduction ? 'info' : 'debug');

        return {
          pinoHttp: {
            level: isTest ? 'silent' : level,
            redact: {
              paths: REDACT_PATHS,
              censor: '[REDACTED]',
            },
            mixin: () => {
              const fields: Record<string, string> = {};
              const tenantId = tenantContext.getTenantId();
              const accountId = tenantContext.getAccountId();
              const correlationId = tenantContext.getCorrelationId();
              if (tenantId) fields['tenantId'] = tenantId;
              if (accountId) fields['accountId'] = accountId;
              if (correlationId) fields['correlationId'] = correlationId;
              return fields;
            },
            transport:
              !isProduction && !isTest
                ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
                : undefined,
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class ObservabilityLoggerModule {}
```

`libs/observability/src/index.ts`:
```ts
export * from './lib/observability-logger.module.js';
```

- [ ] **Step 3: Commit**

Do not typecheck yet — `observability-logger.module.ts` imports `nestjs-pino`, which isn't
installed until Task 2 Step 1. Task 2 Step 5's workspace-wide typecheck covers this lib too; that's
the first point it's verified.

```bash
git add libs/observability
git commit -m "feat(observability): add ObservabilityLoggerModule wrapping nestjs-pino"
```

---

### Task 2: Wire into `apps/api`

**Files:**
- Modify: `new/code/package.json` (root workspace package.json — this repo's real npm
  dependencies live here, e.g. `pg`, `typeorm`, `@nestjs/common`; `apps/api/package.json`'s own
  `dependencies` list is a smaller, already-partial subset used for build metadata, not the actual
  install source of truth)
- Modify: `apps/api/package.json:96` (add `@hospital/observability` to `dependencies`)
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app/app.module.ts`

**Interfaces:**
- Consumes: `ObservabilityLoggerModule` from Task 1.

- [ ] **Step 1: Install `nestjs-pino`, `pino`, `pino-http`, and dev-only `pino-pretty`**

Run from `new/code`:
```bash
pnpm add nestjs-pino pino pino-http
pnpm add -D pino-pretty
```
Expected: `new/code/package.json`'s `dependencies` gains `nestjs-pino`, `pino`, `pino-http`; its
`devDependencies` gains `pino-pretty`. `pnpm-lock.yaml` updates accordingly.

- [ ] **Step 2: Add the workspace dependency on `@hospital/observability` to `apps/api/package.json`**

In `apps/api/package.json`, the `dependencies` block currently reads:
```json
  "dependencies": {
    "@hospital/audit-emitter": "workspace:*",
    "@hospital/auth-guards": "workspace:*",
    "@hospital/tenant-context": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "tslib": "^2.3.0"
  },
```
Add `@hospital/observability` alphabetically, right before `@hospital/tenant-context`:
```json
  "dependencies": {
    "@hospital/audit-emitter": "workspace:*",
    "@hospital/auth-guards": "workspace:*",
    "@hospital/observability": "workspace:*",
    "@hospital/tenant-context": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.0",
    "tslib": "^2.3.0"
  },
```
Then run `pnpm install` from `new/code` to link the new workspace package.

- [ ] **Step 3: Wire the logger into bootstrap**

`apps/api/src/main.ts` currently reads:
```ts
/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Without this, OnModuleDestroy hooks (e.g. closing the database connection pools) never run
  // on SIGTERM/SIGINT — only when something explicitly calls app.close() (as tests do).
  app.enableShutdownHooks();
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
```
Change the top of the file to:
```ts
/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  // Without this, OnModuleDestroy hooks (e.g. closing the database connection pools) never run
  // on SIGTERM/SIGINT — only when something explicitly calls app.close() (as tests do).
  app.enableShutdownHooks();
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
```
Leave the rest of the file (the `DocumentBuilder`/`SwaggerModule` setup and the two `Logger.log(...)`
calls at the bottom) unchanged — `@nestjs/common`'s `Logger` static calls automatically route
through whatever logger `app.useLogger()` installed, so those two lines now also emit structured
JSON without any further edit.

- [ ] **Step 4: Import `ObservabilityLoggerModule` into `AppModule`**

`apps/api/src/app/app.module.ts` currently reads:
```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
```
Add the import line right after the `@nestjs/common` import:
```ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ObservabilityLoggerModule } from '@hospital/observability';
import { TenantContextModule, TenantContextMiddleware } from '@hospital/tenant-context';
import { AuthContextMiddleware } from '@hospital/auth-guards';
import { AuthModule } from '../auth/auth.module.js';
```
And add `ObservabilityLoggerModule` as the first entry in the `@Module({ imports: [...] })` array —
currently:
```ts
  imports: [TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
```
becomes:
```ts
  imports: [ObservabilityLoggerModule, TenantContextModule, AuthModule, TenantsModule, AuditModule, MasterDataModule, PatientsModule, AppointmentsModule, VitalsModule, EncountersModule, TriageModule, AdmissionsModule, OrdersModule, BillingModule, ReportingModule],
```

- [ ] **Step 5: Typecheck and run the existing suite**

Run: `pnpm exec nx run-many -t typecheck test` (from `new/code`)
Expected: all projects typecheck clean; the full existing suite stays green — `app.useLogger()`
swaps the logger implementation but every existing `Logger.log/warn/error/debug` call site keeps
the same call signature, so no other spec should need changes.

- [ ] **Step 6: Manual runtime verification**

Start local Postgres and the API:
```bash
docker-compose -f docker-compose.dev.yml up -d
pnpm exec nx serve api
```
In another terminal, hit an unauthenticated route with a correlation ID header:
```bash
curl -s -H "x-correlation-id: manual-verify-1" http://localhost:3000/api/docs -o /dev/null
```
Expected: the running `nx serve api` terminal prints a pretty-formatted (colorized) log line for
this request that includes `"correlationId":"manual-verify-1"` (or the pretty-printed equivalent
key/value). `tenantId` will be absent on this particular route since it's unauthenticated and
carries no tenant context — that's expected; the same mixin mechanism populates it identically on
any request that does carry tenant context, which is already proven correct by
`libs/tenant-context`'s existing tests (the mixin only reads `TenantContextService`, it doesn't
reimplement any of that logic).

Stop the server (`Ctrl+C`) once confirmed.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/api/package.json apps/api/src/main.ts apps/api/src/app/app.module.ts
git commit -m "feat(observability): wire structured logging into the API"
```

---

### Task 3: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md`
- Modify: `new/docs/technical-design/pending-tasks.md`

**Interfaces:**
- None — documentation only.

- [ ] **Step 1: Add a Development-Standards.md section**

Append after the existing `## 8. Database-Enforced Tenant Isolation` section (which currently ends
the file at line 229):
```markdown

## 9. Structured Logging

Every log line is structured JSON (pretty-printed to stdout only in local dev) via `nestjs-pino`,
configured once in `libs/observability`'s `ObservabilityLoggerModule` and wired into `AppModule`.
`main.ts` calls `app.useLogger(app.get(PinoLogger))` right after `NestFactory.create(AppModule,
{ bufferLogs: true })` — every existing `Logger.log/warn/error/debug` call site (including
`@nestjs/common`'s static `Logger.log(...)` calls) automatically routes through it with no changes
needed at the call site.

**Context is automatic, not manual.** A pino `mixin` — not `pinoHttp.customProps` — reads
`TenantContextService.getTenantId()`/`getAccountId()`/`getCorrelationId()` (from
`@hospital/tenant-context`, backed by `AsyncLocalStorage`) on every single log call, including the
automatic HTTP request-completion line pino-http emits. `mixin` is a core pino option that fires on
every write regardless of caller, which is what makes it safe to reason about independently of
NestJS middleware registration order: it just needs a log call to happen somewhere inside the async
chain `TenantContextMiddleware.use()`'s `tenantContext.run({...}, () => next())` kicked off, which
covers all request-handling code by construction.

**Convention: log specific fields/IDs, never whole entity objects.** This is a hospital EMR — a
`logger.log(patient)` call can leak PHI through any field that happens to be on the entity,
regardless of the redact list below. Always log `{ patientId: patient.id }`, not `patient` itself.

**Redaction is a backstop, not the primary defense.** `ObservabilityLoggerModule` configures pino's
`redact` option with a fixed key-path list: `password`, `token`, `refreshToken`, `authorization`,
`req.headers.authorization`, `req.headers.cookie`, `ssn`, `dob`, `diagnosis`, `phone`, `email`,
`address` (plus a `*.<key>` wildcard variant of each so it's caught one level into any logged
object). It only catches those specific key names — it cannot substitute for the logging
convention above.

**Config:** `LOG_LEVEL` env var (default `debug` outside production, `info` in production; forced
to `silent` when `NODE_ENV === 'test'`, which Jest sets automatically — so the existing test suite
stays quiet without per-spec configuration).

**Deferred:** the two automated tests this feature calls for (an HTTP request's log line carries
`tenantId`/`correlationId`; a redacted key never appears in emitted output — see
`new/docs/superpowers/specs/2026-08-04-structured-logging-design.md`'s Testing section) were not
written as part of this pass, per the human partner's prototype-demo priority — they're left for
the human partner's own post-prototype testing pass, the same deferral pattern as Phase 1 item 3's
Task 7.

See `new/docs/superpowers/plans/2026-08-04-structured-logging.md` for the full implementation
history. Metrics, tracing, and dashboards (the rest of `new-features.md` #10) are a separate,
not-yet-scheduled follow-up.
```

- [ ] **Step 2: Check off `pending-tasks.md` Phase 3 item 6**

In `new/docs/technical-design/pending-tasks.md`, the line currently reads:
```markdown
6. **Observability stack** (new-features.md #10) — stand this up *before* load testing or
   touching auth/isolation in staging, not after.
```
Replace with:
```markdown
6. [x] **Observability stack** (new-features.md #10) — **structured logging only**, done: JSON
   logs via `nestjs-pino`, tagged with `tenantId`/`accountId`/`correlationId` automatically via a
   pino `mixin` reading `TenantContextService`, redaction backstop for known-sensitive keys. The
   rest of this item — Prometheus metrics, OpenTelemetry tracing, Grafana/Loki dashboards and
   alert rules — is **not done** and needs its own future item before load testing (item 9) or
   touching auth/isolation in staging, since those still depend on metrics/tracing, not just logs.
```

- [ ] **Step 3: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md
git commit -m "docs: document structured logging, scope Phase 3 item 6 to logging only"
```
