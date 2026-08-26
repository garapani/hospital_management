# Nx Module-Boundary Enforcement — Design

**Status:** Approved
**Source:** `new/docs/technical-design/pending-tasks.md`, Phase 2 item 4 (`new-features.md` #3)
**Related:** `new/docs/superpowers/specs/2026-07-31-modular-monolith-architecture-design.md` (§12
open question #6 — this spec is that follow-up)

## Problem

The modular-monolith design keeps strict per-module data ownership as a *logical* boundary — "a
hard CI gate against cross-module imports" (per its own Isolation Trade-off section) — instead of
the physical process/DB isolation the original microservices design would have given for free.
That gate does not exist yet:

- No ESLint config of any kind exists in the workspace (no `eslint.config.*`, no `.eslintrc.*`, no
  `@nx/eslint` package installed).
- No Nx project has any tags (`project.json` doesn't exist anywhere in this workspace — all 4
  projects are plugin-inferred from `package.json`'s `nx` field).
- `apps/api` is **one** Nx project containing ~14 domain folders
  (`accounts`, `admissions`, `appointments`, `billing`, `clinical/{vitals,encounters,triage}`,
  `master-data`, `orders`, `patients`, `tenants`, plus `auth`/`rbac`/`audit`/`database`/`app` as
  platform-ish code) as plain subdirectories, not separate Nx projects. This matters because Nx's
  `@nx/enforce-module-boundaries` rule only sees the **project graph** — it can gate imports
  between real Nx projects, but is structurally blind to one folder inside `apps/api` reaching
  into another (e.g. `billing/` importing `patients/entities/patient.entity.ts` directly).
- `.github/workflows/ci.yml` only runs `test`/`typecheck` today — `lint`/`build`/`e2e` are
  intentionally omitted because no real targets exist for them yet (per `new/code/CLAUDE.md`).
- The codebase already has real cross-domain coupling that predates this task (see Decisions
  below) — a naive "no domain may import another domain" rule would break the build on day one.

## Decisions

- **Two enforcement layers, not one.** Nx-native tags govern the 4 real projects
  (`api`, `@hospital/tenant-context`, `@hospital/auth-guards`, `@hospital/audit-emitter`).
  A second, `eslint-plugin-boundaries`-based layer governs the domain folders living inside
  `apps/api/src`, since that project graph has no visibility into them. Both layers use the same
  three-tier tag vocabulary (`scope:platform` / `scope:domain` / `scope:reporting`) so there is one
  mental model across both, not two unrelated configs.
- **`eslint-plugin-boundaries` over hand-written `no-restricted-imports` globs.** Its tag-based
  `element-types` model is a natural extension of Nx's own tag philosophy and is purpose-built for
  many-to-many allow-lists; hand-rolled glob patterns would grow unreadable as more domains are
  added in Phase 6.
- **Tag taxonomy for the intra-`apps/api` layer:**
  - `scope:platform` — `app`, `database`, `rbac`, `audit`, `auth`, `testing`. Any tag may depend on
    platform; platform may depend on nothing outside itself (except the 3 real Nx libs, governed
    by Layer A, and the one explicit exception below: `auth` → `accounts`).
  - `scope:domain` — one element per business module: `accounts`, `admissions`, `appointments`,
    `billing`, `clinical-vitals`, `clinical-encounters`, `clinical-triage`, `master-data`,
    `orders`, `patients`, `tenants`. May depend on `scope:platform` and on the specific
    domain-to-domain edges in the allow-list below — nothing else.
  - `scope:reporting` — `reporting` only. May depend on `scope:platform` and **any** `scope:domain`
    element (it is a cross-domain read-side aggregator by design). No `scope:domain` or
    `scope:platform` element may depend on `scope:reporting`.
- **Cross-tag allow-list (grandfathered, not refactored).** These edges already exist in shipped
  code and reflect real, already-reviewed relationships — they are allow-listed as-is rather than
  refactored behind a shared interface, keeping this task a guardrail, not a redesign:
  | From | To | Tier |
  |---|---|---|
  | `admissions` | `appointments`, `clinical-triage`, `master-data`, `patients` | domain → domain |
  | `billing` | `patients` | domain → domain |
  | `orders` | `patients` | domain → domain |
  | `auth` | `accounts` | platform → domain (exception) |

  Every other cross-tag edge not covered by the general rules above is rejected, including the
  reverse of every edge in this table (e.g. `patients` must never import `admissions`, `accounts`
  must never import `auth`). Any new cross-domain need introduced by a future module must either
  reuse one of these paths or extend the allow-list explicitly in review — that friction is the
  point of the guardrail.
- **Layer A (real Nx projects) tags:** `type:app` for `api`; `type:platform-lib` for the 3 libs.
  Rule: `type:platform-lib` may not depend on `type:app` (the dangerous direction — a shared lib
  must never reach back into the application). `type:app` may depend on any `type:platform-lib`.
  No inter-lib restrictions beyond what already exists (`tenant-context` → `auth-guards`,
  `audit-emitter` → `tenant-context`, both correct today) — encode the current graph, don't add new
  restrictions between libs.
- **CI:** add a `lint` Nx target (via the standard `@nx/eslint` init/convert generators, not
  hand-written target JSON) for all 4 projects, and add it to `.github/workflows/ci.yml` alongside
  the existing `test`/`typecheck` steps.
- **Proof of enforcement — documented example, not a permanent failing fixture.**
  `new-features.md` #3 asks for "at least one negative test or documented example." Rather than
  committing a permanently-lint-failing fixture file, the implementation captures one real
  violation during the work itself (e.g. temporarily making `patients` import from `admissions`),
  runs `nx lint`, records the exact rejection output, then deletes the scratch violation. That
  captured transcript goes into a new `Development-Standards.md` section as the documented
  example — proves the rule fires without carrying dead lint-breaking code in the repo long-term.

## Non-goals

- Extracting the ~14 domain folders into real Nx libraries. That would let Layer A alone govern
  everything natively, but is a large structural refactor and contradicts this item's "cheap
  guardrail" framing in `pending-tasks.md`. Worth revisiting later if the modular monolith's
  domain count keeps growing, but out of scope here.
- Refactoring the grandfathered domain-to-domain edges behind shared interfaces/facades.
- Any change to runtime behavior. This is lint/CI configuration only — zero production code paths
  change.

## Testing

- `nx lint` (new target) must pass clean across all 4 projects once the config lands.
- The full existing suite (`nx run-many -t typecheck test`) must remain green — this task touches
  no production source.
- One captured negative-example transcript (see above), recorded in `Development-Standards.md`,
  standing in for an automated negative test per `new-features.md` #3's own wording.
