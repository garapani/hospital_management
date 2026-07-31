# Rename apps/identity-access to apps/api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the existing `apps/identity-access` Nx application to `apps/api`, with zero behavior change, as the first mechanical step of the modular-monolith pivot (`docs/superpowers/specs/2026-07-31-modular-monolith-architecture-design.md`). `apps/api` becomes the one application every future domain module (System Admin, Master Data, etc.) is added to.

**Architecture:** Pure identity/naming change — directory move plus updating every place that names the app by its old identifier (`package.json`, jest config, root `tsconfig.json`'s project reference, `docker-compose.dev.yml`, a few source comments, and the personal `.vscode/launch.json`). No entities, tables, routes, or business logic change. Internal relative import paths (`../../libs/...`) are unaffected because the app stays at the same nesting depth (`apps/<name>/`), just under a new name.

**Tech Stack:** Nx (pnpm workspaces), NestJS/TypeScript, Jest, Docker Compose — unchanged from the existing app.

## Global Constraints

- Use `pnpm exec nx run-many -t test typecheck` (not just `test`) to verify — this workspace's tsconfig uses `"module"`/`"moduleResolution": "nodenext"`, and only `typecheck` (not Jest's transform) catches missing `.js` extensions on relative imports.
- Use `--testPathPatterns` (plural) if running Jest directly for any individual file — `--testPathPattern` (singular) errors on this Jest version ("Option was replaced by --testPathPatterns").
- Move the app directory with plain `mv apps/identity-access apps/api`, **not** `git mv` and **not** any `rm`-based approach. `dist/`, `out-tsc/`, and `node_modules/` inside the app directory are gitignored/untracked build artifacts; plain `mv` relocates them along with the tracked source with no deletion involved, avoiding the destructive-command guard entirely. `git add -A` afterward lets git's own rename detection produce clean renames for the tracked files.
- Root `tsconfig.json` is a protected config file (blocked from `Edit`/`Write`/`MultiEdit` by this repo's `guard-config.sh` hook). Modify its one changed line via `Bash`/`sed`, per the exact precedent already reviewed and approved in the prior plan's Task 3 and Task 5 (`nx sync` modifying `tsconfig.app.json` via Bash) — this is sanctioned by this plan, not a hook workaround.
- Leave the Postgres credentials (`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` values of `identity_access`/`identity_access_dev_password`) and the port (`5433`) unchanged in `docker-compose.dev.yml` — only the service key, `container_name`, and volume name change, to minimize unrelated churn (matches the design spec's stated intent).
- No test's assertions or business logic may change. If a test needs editing at all, it's because it names the app itself (e.g. a `describe()` label) — a cosmetic rename, not a behavior change.

---

### Task 1: Rename the app and every reference to its old name

**Files:**
- Move: `apps/identity-access/` → `apps/api/` (entire directory, via `mv`)
- Modify: `apps/api/package.json`
- Modify: `apps/api/jest.config.cts`
- Modify: `tsconfig.json` (repo root, `new/code/tsconfig.json`)
- Modify: `docker-compose.dev.yml` (repo root, `new/code/docker-compose.dev.yml`)
- Modify: `apps/api/src/esm-package-type.spec.ts`
- Modify: `apps/api/src/tenant-context-interop.spec.ts`
- Modify: `apps/api/src/verify-esm-interop.ts`
- Modify: `.vscode/launch.json` (untracked personal editor config — not committed, but keep local debugging working)
- Modify (auto-regenerated): `pnpm-lock.yaml`

**Interfaces:** N/A — this task has no consumers within the plan; it's the only task.

- [ ] **Step 1: Move the app directory**

Run from `new/code`:

```bash
mv apps/identity-access apps/api
```

- [ ] **Step 2: Rename identifiers in `apps/api/package.json`**

Change the top-level `"name"` field:

```json
"name": "@org/identity-access",
```
→
```json
"name": "@org/api",
```

Change the Nx project name:

```json
"nx": {
  "name": "identity-access",
```
→
```json
"nx": {
  "name": "api",
```

The `serve` target references the project by its Nx name in three places — update all three:

```json
"serve": {
  "continuous": true,
  "executor": "@nx/js:node",
  "defaultConfiguration": "development",
  "dependsOn": [
    "build"
  ],
  "options": {
    "buildTarget": "identity-access:build",
    "runBuildTargetDependencies": false
  },
  "configurations": {
    "development": {
      "buildTarget": "identity-access:build:development"
    },
    "production": {
      "buildTarget": "identity-access:build:production"
    }
  }
},
```
→
```json
"serve": {
  "continuous": true,
  "executor": "@nx/js:node",
  "defaultConfiguration": "development",
  "dependsOn": [
    "build"
  ],
  "options": {
    "buildTarget": "api:build",
    "runBuildTargetDependencies": false
  },
  "configurations": {
    "development": {
      "buildTarget": "api:build:development"
    },
    "production": {
      "buildTarget": "api:build:production"
    }
  }
},
```

Leave every dependency, devDependency, and every other target (`build`, `prune-lockfile`, `copy-workspace-modules`, `prune`, `test`) exactly as they are — they don't reference the project by name.

- [ ] **Step 3: Rename the Jest display name in `apps/api/jest.config.cts`**

```ts
module.exports = {
  displayName: 'identity-access',
```
→
```ts
module.exports = {
  displayName: 'api',
```

- [ ] **Step 4: Update the root `tsconfig.json` project reference**

This is a protected file — do not use the `Edit` or `Write` tool on it. Run from `new/code`:

```bash
sed -i '' 's|"./apps/identity-access"|"./apps/api"|' tsconfig.json
```

Verify the change landed correctly:

```bash
grep -n "apps/api" tsconfig.json
```

Expected: one line showing `"path": "./apps/api"`.

- [ ] **Step 5: Rename the Postgres service/container/volume in `docker-compose.dev.yml`**

Current content:

```yaml
services:
  identity-access-postgres:
    image: postgres:16-alpine
    container_name: identity-access-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - identity-access-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  identity-access-postgres-data:
```

Replace with:

```yaml
services:
  api-postgres:
    image: postgres:16-alpine
    container_name: api-postgres-dev
    environment:
      POSTGRES_USER: identity_access
      POSTGRES_PASSWORD: identity_access_dev_password
      POSTGRES_DB: identity_access
    ports:
      - '5433:5432'
    volumes:
      - api-postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U identity_access']
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  api-postgres-data:
```

Note: the `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` values and the port stay `identity_access`/`identity_access_dev_password`/`5433` unchanged — only the service key, `container_name`, and volume name change (Global Constraints).

- [ ] **Step 6: Update cosmetic app-name references in source comments and labels**

In `apps/api/src/esm-package-type.spec.ts`, change the `describe()` label:

```ts
describe('identity-access package.json module type', () => {
```
→
```ts
describe('apps/api package.json module type', () => {
```

In `apps/api/src/tenant-context-interop.spec.ts`, update the two comment lines that name the app (do not change any executable code or assertions — this file's logic is untouched):

```ts
// Smoke test: proves identity-access (a CommonJS-by-default app under Nx's
```
→
```ts
// Smoke test: proves apps/api (a CommonJS-by-default app under Nx's
```

and

```ts
// condition). If apps/identity-access/package.json is missing
```
→
```ts
// condition). If apps/api/package.json is missing
```

In `apps/api/src/verify-esm-interop.ts`, update every `apps/identity-access/...` path mentioned in the header comment block to `apps/api/...` (there are five such lines — search the file for `identity-access` to find each one; this file is comments/documentation only, no executable logic changes).

- [ ] **Step 7: Update the personal VS Code launch config**

`.vscode/launch.json` is untracked (not part of any commit) but keep it working for local debugging:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug identity-access with Nx",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["exec", "nx", "serve", "identity-access"],
  ...
  "outFiles": [
    "${workspaceFolder}/apps/identity-access/dist/**/*.(m|c|)js",
    "!**/node_modules/**"
  ]
}
```
→
```json
{
  "type": "node",
  "request": "launch",
  "name": "Debug api with Nx",
  "runtimeExecutable": "pnpm",
  "runtimeArgs": ["exec", "nx", "serve", "api"],
  ...
  "outFiles": [
    "${workspaceFolder}/apps/api/dist/**/*.(m|c|)js",
    "!**/node_modules/**"
  ]
}
```

- [ ] **Step 8: Reinstall to regenerate the lockfile**

Run from `new/code`:

```bash
pnpm install
```

This updates `pnpm-lock.yaml`'s importer entry from `apps/identity-access` to `apps/api` and the package name. Expected: installs cleanly, `pnpm-lock.yaml` shows a diff limited to the renamed package's entry.

- [ ] **Step 9: Verify the full suite passes under the new name**

Run from `new/code`:

```bash
pnpm exec nx reset
pnpm exec nx run-many -t test typecheck --skip-nx-cache
```

Expected: same results as before the rename — 11 test suites passed, 46 tests passed, 0 typecheck errors. (`nx reset` first, in case Nx's project graph cache still resolves the old `identity-access` project name.)

- [ ] **Step 10: Verify the renamed dev Postgres container starts**

Run from `new/code`:

```bash
docker compose -f docker-compose.dev.yml up -d api-postgres
docker compose -f docker-compose.dev.yml ps
```

Expected: a container named `api-postgres-dev` reported healthy. The old `identity-access-postgres-data` volume (if it exists from prior dev sessions) is orphaned by this rename — the new `api-postgres-data` volume starts empty, which is fine since dev/test data here is disposable and recreated by migrations/seeds on demand, not anything that needs preserving.

- [ ] **Step 11: Commit**

```bash
git add -A
git status
```

Confirm git reports clean renames (`R100` or similar) for the moved app files, plus modifications to `docker-compose.dev.yml`, `tsconfig.json`, and `pnpm-lock.yaml`. Then:

```bash
git commit -m "refactor: rename apps/identity-access to apps/api for the modular-monolith pivot"
```
