# Nx Module-Boundary Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI-enforced module-boundary lint gate to the `new/code` Nx workspace — real Nx
project tags for the 4 actual projects, plus a folder-tagged `eslint-plugin-boundaries` layer for
the domain folders living inside the single `apps/api` project, matching the design spec.

**Architecture:** Two independent ESLint rule layers share one root flat config
(`new/code/eslint.config.mjs`) and one three-tier tag vocabulary (`scope:platform` /
`scope:domain` / `scope:reporting`). Layer A is Nx-native (`@nx/enforce-module-boundaries`,
governs the 4 real projects via `package.json`'s `nx.tags` field — this workspace has no
`project.json` files anywhere, all projects are plugin-inferred). Layer B is
`eslint-plugin-boundaries` (governs the ~14 domain folders inside `apps/api/src`, which the Nx
project graph cannot see). No production code changes anywhere in this plan.

**Tech Stack:** `@nx/eslint` 23.1.0, `@nx/eslint-plugin` 23.1.0 (matching the workspace's existing
Nx version — see every other `@nx/*` devDependency in `new/code/package.json`), `eslint` ^9.x
(flat config), `eslint-plugin-boundaries` (latest — a plain npm package, not Nx-versioned).

## Global Constraints

- No production source file changes. This plan only touches: root `package.json`,
  `new/code/package.json`, `new/code/pnpm-lock.yaml`, `new/code/nx.json`,
  `new/code/eslint.config.mjs` (new), `new/code/.github/workflows/ci.yml`, and the 4 projects'
  `package.json` `nx.tags` fields, plus documentation files.
- `@nx/eslint` and `@nx/eslint-plugin` MUST be pinned to `23.1.0` — the exact version already used
  by every other `@nx/*` package in `new/code/package.json` (`@nx/jest`, `@nx/js`, `@nx/node`,
  `@nx/web`, `@nx/webpack` are all pinned to `"23.1.0"` with no caret).
- `@nx/eslint-plugin` is a **separate package** from `@nx/eslint` (confirmed by inspecting the
  installed `@nx/eslint` package's own `dependencies` — it does not list `@nx/eslint-plugin`, and
  `require.resolve('@nx/eslint-plugin/package.json')` fails until it's installed explicitly). Both
  must be added as direct devDependencies.
- This Nx version's `@nx/eslint` generator set is `init`, `workspace-rules-project`,
  `workspace-rule`, `convert-to-flat-config`, `convert-to-inferred` — there is **no**
  per-project `lint-project`/`configuration` generator. The root `eslint.config.mjs` must be
  hand-authored (Task 1 gives its exact content, reverse-engineered from
  `@nx/eslint`'s own `getGlobalFlatEslintConfiguration` generator template).
- Domain-to-domain / cross-tag allow-list — **corrected during implementation** from what the
  design spec originally specified, based on real errors surfaced by actually running the linter
  against the codebase (see Task 3's implementation note below for why):
  | From | To | Tier |
  |---|---|---|
  | `admissions` | `appointments`, `clinical-triage`, `master-data`, `patients` | domain → domain |
  | `billing` | `patients` | domain → domain |
  | `orders` | `patients` | domain → domain |
  | `clinical-triage` | `patients` | domain → domain (test-fixture only) |
  | `clinical-vitals` | `patients` | domain → domain (test-fixture only) |
  | `scope:platform` (`app`, `database`, `rbac`, `audit`, `auth`, `testing`) | every domain + `scope:reporting` | platform → domain (broadened — see below) |

  Every other domain-to-domain edge is rejected, including every listed edge's reverse (e.g.
  `patients` must never import `admissions`).

  **Why platform was broadened instead of narrowed:** the original design tried to keep
  `scope:platform` restricted to `{platform, one domain exception for auth→accounts}` and planned
  a separate narrow `scope:composition` tier for `app.module.ts`/DB configs. In practice,
  `app.module.ts` wires every domain module together, `database/data-source.ts` and
  `reporting-data-source.ts` register every domain's TypeORM entities, and
  `testing/tenant-test-context.ts` seeds fixtures across domains — all genuinely composition-root
  behavior living inside what this plan calls "platform" folders. `eslint-plugin-boundaries`
  classifies at folder granularity only (confirmed via its own runtime warning: "Element patterns
  match folders, not individual files"), so a file-level split wasn't viable without physically
  moving files — out of scope for a lint-only task. The actual goal (per new-features.md #3 and the
  design spec) is stopping domain-to-domain leakage, not restricting platform/infra code's own
  reads — so `scope:platform` was broadened to allow any domain + reporting, and domains kept their
  original strict allow-list. This is a correction to the design's mental model, not a
  weakening of the enforcement that matters.
- `scope:platform` folders: `app`, `database`, `rbac`, `audit`, `auth`, `testing`.
  `scope:domain` folders: `accounts`, `admissions`, `appointments`, `billing`,
  `clinical/vitals` (tag `clinical-vitals`), `clinical/encounters` (tag `clinical-encounters`),
  `clinical/triage` (tag `clinical-triage`), `master-data`, `orders`, `patients`, `tenants`.
  `scope:reporting` folder: `reporting`.
- `.js` extensions on every relative import (ESM + `nodenext`) — this plan adds no new relative
  imports in production code, so this constraint only matters if a step's own scratch/test code
  needs one.
- Never `git commit --amend`. No AI co-authorship trailer in any commit message.
- Run `pnpm exec nx run-many -t typecheck test lint` (note: `lint` is new — earlier plans only had
  `typecheck test`) before considering any task done, not just `test`.

---

### Task 1: Install ESLint tooling + bootstrap the root flat config

**Files:**
- Modify: `new/code/package.json` (add devDependencies)
- Modify: `new/code/pnpm-lock.yaml` (via `pnpm install`)
- Modify: `new/code/nx.json` (via generator)
- Modify: `new/code/.vscode/extensions.json` (via generator)
- Create: `new/code/eslint.config.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a working `nx run-many -t lint` across all 4 projects with zero custom rules yet
  (baseline proof the wiring itself works, before Layer A/B rules are added in Tasks 2-3)

- [ ] **Step 1: Install `@nx/eslint` and `@nx/eslint-plugin`, pinned to the workspace's Nx version**

From `new/code/`:

```bash
pnpm add -D -w @nx/eslint@23.1.0 @nx/eslint-plugin@23.1.0
```

Verify both landed in `new/code/package.json`'s `devDependencies` at exactly `"23.1.0"` (no caret),
matching `@nx/jest`/`@nx/js`/`@nx/node`/`@nx/web`/`@nx/webpack`'s existing pinning style.

- [ ] **Step 2: Run the `@nx/eslint:init` generator**

```bash
pnpm exec nx g @nx/eslint:init --no-interactive
```

Expected effects (verified by running this exact command during plan-writing, then reverted):
- `new/code/nx.json`: adds `{"plugin": "@nx/eslint/plugin", "options": {"targetName": "lint"}}` to
  the `plugins` array, and adds `"!{projectRoot}/.eslintrc.json"` +
  `"!{projectRoot}/eslint.config.mjs"` to the `production` namedInput's exclusion list.
- `new/code/package.json`: adds `"eslint": "^9.8.0"` (or whatever current range `pnpm` resolves —
  do not hand-edit this, let the generator/pnpm pick it) to `devDependencies`.
- `new/code/.vscode/extensions.json`: adds the ESLint VS Code extension recommendation.
- `new/code/pnpm-lock.yaml`: updates accordingly.

This generator does **not** create `eslint.config.mjs` in this Nx version — that's Step 3.

- [ ] **Step 3: Hand-author the root flat config**

Create `new/code/eslint.config.mjs`:

```js
import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            // Every project depends on this root config file; without this the rule
            // would flag every project's own reference to it as a boundary violation.
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
          ],
          depConstraints: [
            // Task 2 replaces this permissive placeholder with the real constraints.
            { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {},
  },
];
```

This mirrors exactly what `@nx/eslint`'s own `getGlobalFlatEslintConfiguration` generator function
produces for a non-root-project workspace (confirmed by reading
`@nx/eslint/dist/src/generators/init/global-eslint-config.js` in the installed package during
plan-writing) — just without depending on a generator that doesn't exist in this Nx version to
write it for us.

- [ ] **Step 4: Run lint across all 4 projects, confirm it passes clean**

```bash
pnpm exec nx run-many -t lint
```

Expected: all 4 projects (`api`, `@hospital/tenant-context`, `@hospital/auth-guards`,
`@hospital/audit-emitter`) report a `lint` target now exists and passes with zero errors — the
`depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]` placeholder allows
everything, so this step only proves the tooling wiring itself works, not that boundaries are
enforced yet.

- [ ] **Step 5: Run the full suite to confirm no regression**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: same typecheck/test results as before this task (46/46 suites, 279/279 tests, per the
last known-green baseline), plus `lint` now passing on all 4 projects.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml nx.json .vscode/extensions.json eslint.config.mjs
git commit -m "feat(lint): bootstrap Nx ESLint flat config and lint target"
```

---

### Task 2: Layer A — real Nx project tags + `enforce-module-boundaries` constraints

**Files:**
- Modify: `new/code/apps/api/package.json` (`nx.tags`)
- Modify: `new/code/libs/tenant-context/package.json` (`nx.tags`)
- Modify: `new/code/libs/auth-guards/package.json` (`nx.tags`)
- Modify: `new/code/libs/audit-emitter/package.json` (`nx.tags`)
- Modify: `new/code/eslint.config.mjs` (replace the Task 1 placeholder `depConstraints`)

**Interfaces:**
- Consumes: `eslint.config.mjs`'s `@nx/enforce-module-boundaries` rule block (Task 1)
- Produces: `type:app` / `type:platform-lib` tags other tooling/docs can reference

- [ ] **Step 1: Tag the 4 projects**

In `new/code/apps/api/package.json`, inside the existing `"nx"` object (alongside the existing
`"name"` and `"targets"` keys), add:

```json
"tags": ["type:app"]
```

In each of `new/code/libs/tenant-context/package.json`, `new/code/libs/auth-guards/package.json`,
`new/code/libs/audit-emitter/package.json` — these currently have no `"nx"` key at all, so add one:

```json
"nx": {
  "tags": ["type:platform-lib"]
}
```

- [ ] **Step 2: Replace the placeholder `depConstraints` in `eslint.config.mjs`**

Change:

```js
          depConstraints: [
            // Task 2 replaces this permissive placeholder with the real constraints.
            { sourceTag: '*', onlyDependOnLibsWithTags: ['*'] },
          ],
```

to:

```js
          depConstraints: [
            {
              sourceTag: 'type:platform-lib',
              onlyDependOnLibsWithTags: ['type:platform-lib'],
            },
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:platform-lib', 'type:app'],
            },
          ],
```

This encodes: a platform lib (`tenant-context`, `auth-guards`, `audit-emitter`) may depend only on
other platform libs (matches today's real graph: `tenant-context` → `auth-guards`,
`audit-emitter` → `tenant-context`) and never on `api`. The app may depend on any platform lib or
on itself.

- [ ] **Step 3: Verify the rule fires on a real violation, then revert it**

Temporarily add a throwaway import to `new/code/libs/auth-guards/src/index.ts` that reaches into
`apps/api` (the forbidden direction — a platform lib importing the app):

```ts
import '../../../apps/api/src/main.js';
```

Run:

```bash
pnpm exec nx lint auth-guards
```

Expected: a `@nx/enforce-module-boundaries` violation naming `type:platform-lib` and `type:app`.
Record the exact output text (needed for `Development-Standards.md` in Task 6). Then remove the
throwaway import — `git diff libs/auth-guards/src/index.ts` must be empty again before continuing.

- [ ] **Step 4: Run lint clean across all 4 projects**

```bash
pnpm exec nx run-many -t lint
```

Expected: all 4 projects pass — the real dependency graph (`api` → all 3 libs,
`tenant-context` → `auth-guards`, `audit-emitter` → `tenant-context`) satisfies the new
constraints without any code changes.

- [ ] **Step 5: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: unchanged typecheck/test results, `lint` clean on all 4 projects.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json libs/tenant-context/package.json libs/auth-guards/package.json libs/audit-emitter/package.json eslint.config.mjs
git commit -m "feat(lint): tag the 4 Nx projects and enforce real dependency constraints"
```

---

### Task 3: Layer B — `eslint-plugin-boundaries` for the domain folders inside `apps/api`

> **Implementation note:** the exact rule name, option shape, and element-tag taxonomy below were
> corrected during execution based on real errors from actually running the linter — see the
> Global Constraints section above for the final, verified allow-list and taxonomy, and
> `new/code/eslint.config.mjs` on `main` for the actual shipped config. The code sample in this
> task's Step 2 reflects the plan's original (pre-verification) design and does not match what
> shipped; kept for historical context on what was originally proposed.

**Files:**
- Modify: `new/code/package.json` (add `eslint-plugin-boundaries` devDependency)
- Modify: `new/code/pnpm-lock.yaml`
- Modify: `new/code/eslint.config.mjs` (add the Layer B block)

**Interfaces:**
- Consumes: nothing new from Tasks 1-2 (independent config block in the same file)
- Produces: `boundaries/element-types` rule scoped to `apps/api/src/**`, enforcing the
  `scope:platform` / `scope:domain` / `scope:reporting` taxonomy and its allow-list

- [ ] **Step 1: Install `eslint-plugin-boundaries`**

```bash
pnpm add -D -w eslint-plugin-boundaries
```

This is a plain community ESLint plugin, not an Nx package — no version pin required, let `pnpm`
resolve latest.

- [ ] **Step 2: Add the Layer B config block to `eslint.config.mjs`**

Append a new entry to the exported array (after the existing blocks from Tasks 1-2):

```js
import boundaries from 'eslint-plugin-boundaries';

// ... (keep the existing `nx` import and all blocks from Tasks 1-2 above this)

export default [
  // ...existing blocks from Task 1/2...
  {
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['apps/api/src/**/*.ts'],
      'boundaries/elements': [
        { type: 'scope:platform', pattern: 'apps/api/src/(app|database|rbac|audit|auth|testing)/**' },
        { type: 'domain:accounts', pattern: 'apps/api/src/accounts/**' },
        { type: 'domain:admissions', pattern: 'apps/api/src/admissions/**' },
        { type: 'domain:appointments', pattern: 'apps/api/src/appointments/**' },
        { type: 'domain:billing', pattern: 'apps/api/src/billing/**' },
        { type: 'domain:clinical-vitals', pattern: 'apps/api/src/clinical/vitals/**' },
        { type: 'domain:clinical-encounters', pattern: 'apps/api/src/clinical/encounters/**' },
        { type: 'domain:clinical-triage', pattern: 'apps/api/src/clinical/triage/**' },
        { type: 'domain:master-data', pattern: 'apps/api/src/master-data/**' },
        { type: 'domain:orders', pattern: 'apps/api/src/orders/**' },
        { type: 'domain:patients', pattern: 'apps/api/src/patients/**' },
        { type: 'domain:tenants', pattern: 'apps/api/src/tenants/**' },
        { type: 'scope:reporting', pattern: 'apps/api/src/reporting/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: ['scope:platform'],
              allow: ['scope:platform', 'domain:accounts'],
              // ^ the one explicit exception: auth (scope:platform) -> accounts (domain)
            },
            {
              from: [
                'domain:accounts', 'domain:admissions', 'domain:appointments', 'domain:billing',
                'domain:clinical-vitals', 'domain:clinical-encounters', 'domain:clinical-triage',
                'domain:master-data', 'domain:orders', 'domain:patients', 'domain:tenants',
              ],
              allow: ['scope:platform'],
            },
            { from: ['domain:admissions'], allow: ['domain:appointments', 'domain:clinical-triage', 'domain:master-data', 'domain:patients'] },
            { from: ['domain:billing'], allow: ['domain:patients'] },
            { from: ['domain:orders'], allow: ['domain:patients'] },
            { from: ['scope:reporting'], allow: ['scope:platform', 'domain:accounts', 'domain:admissions', 'domain:appointments', 'domain:billing', 'domain:clinical-vitals', 'domain:clinical-encounters', 'domain:clinical-triage', 'domain:master-data', 'domain:orders', 'domain:patients', 'domain:tenants'] },
          ],
        },
      ],
    },
  },
];
```

Note: this config assumes `eslint-plugin-boundaries`' `element-types` rule unions every matching
`rules` entry for a given source type (so `domain:admissions` gets both the generic "any domain
may depend on platform" allowance *and* its specific extra domain-to-domain edges from the two
separate entries that each name it), rather than only applying the first match. **Step 3 is what
actually proves this empirically** — if `nx lint api` fails on a currently-legitimate import (e.g.
`admissions` importing `master-data`), that means matches don't union, and each domain needs a
single consolidated rule entry listing all of its allowed targets (platform + its specific
extras) instead of two separate entries. Don't assume either behavior — trust what Step 3's actual
run shows.

- [ ] **Step 3: Run lint on `api` and confirm it's clean against current code**

```bash
pnpm exec nx lint api
```

**First check the glob patterns resolve correctly for how Nx actually invokes ESLint for this
project** (not verified during plan-writing — the install needed to test this was interrupted).
If every file in `apps/api/src` is reported as "not matching any element type" or similar, Nx is
running `eslint` with cwd set to `apps/api/` itself, and every pattern in `boundaries/elements`
and the `files`/`boundaries/include` entries above needs `apps/api/` stripped (e.g.
`apps/api/src/accounts/**` → `src/accounts/**`, `apps/api/src/**/*.ts` → `src/**/*.ts`). Adjust all
patterns in Step 2's block consistently if so, then re-run this command.

Once patterns resolve correctly, expected: passes clean. This is the step that proves the
allow-list correctly grandfathers every edge that exists in the current codebase (per the design
spec's grep-verified list) — if it still fails after patterns are confirmed correct, an edge is
missing from the `rules` array above; re-check
`grep -rhoE "from '\.\./\.\./?(accounts|admissions|appointments|billing|clinical|master-data|orders|patients|tenants|auth|reporting|rbac|audit)[^']*'" apps/api/src` for anything the allow-list
doesn't cover yet, and add it as its own explicit `{ from: [...], allow: [...] }` entry rather than
widening an existing one.

- [ ] **Step 4: Run the full suite**

```bash
pnpm exec nx run-many -t typecheck test lint
```

Expected: unchanged typecheck/test results, `lint` clean on all 4 projects (Layer A + Layer B both
active now).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml eslint.config.mjs
git commit -m "feat(lint): add eslint-plugin-boundaries for apps/api's domain folders"
```

---

### Task 4: Verify Layer B actually rejects a forbidden import (captured negative example)

**Files:**
- None committed — this task only produces a captured text transcript for Task 6 to paste into
  documentation. No file changes land from this task.

**Interfaces:**
- Consumes: the `boundaries/element-types` rule from Task 3
- Produces: a verbatim captured CLI transcript, handed to Task 6

- [ ] **Step 1: Introduce one real forbidden import**

In `new/code/apps/api/src/patients/patients.service.ts`, temporarily add at the top of the file:

```ts
import { AdmissionsService } from '../admissions/admissions.service.js';
```

(`patients` → `admissions` is the reverse of the one sanctioned `admissions` → `patients` edge —
exactly the kind of accidental reverse-direction import the guardrail exists to catch.)

- [ ] **Step 2: Run lint and capture the exact output**

```bash
pnpm exec nx lint api
```

Expected: a `boundaries/element-types` violation. The exact wording depends on the installed
`eslint-plugin-boundaries` version — copy the full, real CLI output verbatim (don't paraphrase or
guess it ahead of time) into a scratch note; Task 6 pastes this transcript into
`Development-Standards.md` as the documented example `new-features.md` #3 asks for.

- [ ] **Step 3: Revert the scratch import**

```bash
git diff apps/api/src/patients/patients.service.ts
```

Expected: after removing the added import line, this diff is empty. Do not commit anything from
this task.

- [ ] **Step 4: Re-run lint to confirm clean again**

```bash
pnpm exec nx lint api
```

Expected: passes clean, confirming the scratch violation left no residue.

---

### Task 5: Wire `lint` into CI

**Files:**
- Modify: `new/code/.github/workflows/ci.yml:36-38`

**Interfaces:**
- Consumes: the `lint` Nx target (Task 1)
- Produces: nothing further consumed by later tasks

- [ ] **Step 1: Replace the "lint intentionally omitted" comment and wire the real step**

Current (`new/code/.github/workflows/ci.yml:36-38`):

```yaml
      - run: pnpm exec nx format:check --base="remotes/origin/main"
      # lint/build/e2e are intentionally omitted: no ESLint config, build, or
      # e2e targets exist yet for any project, so nx run-many would silently
      # no-op on them. Add them back once those targets are actually wired up.
      - run: pnpm exec nx run-many -t test typecheck
```

Change to:

```yaml
      - run: pnpm exec nx format:check --base="remotes/origin/main"
      # build/e2e are intentionally omitted: no build or e2e targets exist yet
      # for any project, so nx run-many would silently no-op on them. Add them
      # back once those targets are actually wired up.
      - run: pnpm exec nx run-many -t test typecheck lint
```

- [ ] **Step 2: Run the same command locally to confirm it passes**

```bash
pnpm exec nx run-many -t test typecheck lint
```

Expected: all 4 projects green across all 3 targets.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint to the CI target list now that ESLint is wired up"
```

---

### Task 6: Documentation

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md` (new section)
- Modify: `new/docs/technical-design/pending-tasks.md` (check off Phase 2 item 4)
- Modify: `new/docs/technical-design/review-comments.md` (mark the module-boundary finding
  resolved, don't delete it — historical record)

**Interfaces:**
- Consumes: the captured transcript from Task 4
- Produces: nothing (last task)

- [ ] **Step 1: Add a "Module Boundaries" section to `Development-Standards.md`**

Add a new `## 7. Module Boundaries` section after the existing `## 6. Request Authentication`
section (which ends at line 124). Cover:
- Two enforcement layers: `@nx/enforce-module-boundaries` (Layer A) governs the 4 real Nx projects
  (`api` tagged `type:app`; the 3 libs tagged `type:platform-lib`) — a platform lib may never
  depend on the app.
- `eslint-plugin-boundaries` (Layer B) governs the domain folders inside `apps/api/src` (which the
  Nx project graph can't see) via the `scope:platform` / `scope:domain` / `scope:reporting` tags
  and the allow-list from this plan's Global Constraints table — say explicitly that a new domain
  folder added in a future phase must either reuse an existing allowed edge or have the allow-list
  extended in review, and that this is deliberate friction, not an oversight.
- Paste the exact transcript captured in Task 4, Step 2, as the documented negative example (fenced
  code block, labeled as real captured CLI output, not illustrative).
- `pnpm exec nx run-many -t lint` runs in CI (link `.github/workflows/ci.yml`).

- [ ] **Step 2: Check off `pending-tasks.md` Phase 2 item 4**

Change:

```markdown
4. **Nx module-boundary lint** (new-features.md #3) — cheap (ESLint config + Nx project tags +
   CI target). Land it before the Phase 6 backlog adds ~15 more modules, not after.
```

to:

```markdown
4. [x] **Nx module-boundary lint** (new-features.md #3) — done: `@nx/enforce-module-boundaries`
   tags the 4 real Nx projects, `eslint-plugin-boundaries` tags the domain folders inside
   `apps/api`, both wired into CI via the `lint` target.
```

- [ ] **Step 3: Update the `review-comments.md` finding**

Find "### High: Module-boundary linting is presented as active enforcement, but lint is not
configured or run" and add directly under its heading (keep the finding itself — historical
record):

```markdown
**Resolved:** `@nx/enforce-module-boundaries` (Nx project tags) and `eslint-plugin-boundaries`
(domain-folder tags inside `apps/api`) are both wired and running in CI via the `lint` target; see
`new/docs/superpowers/plans/2026-08-04-nx-module-boundary-enforcement.md`.
```

- [ ] **Step 4: Commit**

```bash
git add new/docs/technical-design/Development-Standards.md new/docs/technical-design/pending-tasks.md new/docs/technical-design/review-comments.md
git commit -m "docs: document module-boundary enforcement, check off Phase 2 item 4"
```
