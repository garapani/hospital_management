# Technical Design Review Comments

Review target: `new/docs/technical-design/`

## Findings

### High: Authorization and tenant selection are documented as JWT-backed, but current code trusts request headers

**Resolved:** `AuthContextMiddleware` now verifies `Authorization: Bearer <token>` on every route except `/auth/login`/`/auth/refresh`; see `new/docs/superpowers/plans/2026-08-03-jwt-request-authentication.md`.

The PRD says tenant resolution comes from the `hospitalId` JWT claim and that the application guard validates JWTs before checking permissions:

- `new/docs/technical-design/PRD.md:52`
- `new/docs/technical-design/PRD.md:173`

Current implementation reads tenant and permissions directly from client-controlled headers:

- `new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts:11`
- `new/code/libs/auth-guards/src/lib/permission.guard.ts:24`
- `new/code/libs/auth-guards/src/lib/request-context.ts:21`

This overstates the current security model. Either implement JWT validation on protected routes and derive tenant/permissions from verified claims, or mark the docs as target-state and explicitly call out the temporary header-backed guard.

### High: Tenant isolation is described as Postgres role-enforced, but implementation uses one DB user plus search_path

The PRD says tenant schemas are isolated by Postgres role-level schema grants:

- `new/docs/technical-design/PRD.md:240`
- `new/docs/technical-design/PRD.md:316`

Current implementation uses one configured database user and changes `search_path` at runtime:

- `new/code/apps/api/src/database/data-source.ts:49`
- `new/code/apps/api/src/database/data-source.ts:51`
- `new/code/apps/api/src/database/tenant-connection.service.ts:26`

That is materially weaker than the documented guarantee. A bug in tenant resolution can still point the shared connection at another tenant schema. Either add the role/grant model or rewrite the docs to describe the actual guarantee and residual risk.

### High: Module-boundary linting is presented as active enforcement, but lint is not configured or run

The docs repeatedly say `@nx/enforce-module-boundaries` is the hard enforcement mechanism:

- `new/docs/technical-design/Development-Standards.md:10`
- `new/docs/technical-design/PRD.md:307`
- `new/docs/technical-design/PRD.md:315`
- `new/docs/technical-design/PRD.md:327`

But the PRD also admits the concrete config does not exist:

- `new/docs/technical-design/PRD.md:373`

And CI explicitly omits lint:

- `new/code/.github/workflows/ci.yml:36`
- `new/code/.github/workflows/ci.yml:37`

Until ESLint/project tags are wired and CI runs the lint target, the docs should not claim boundary enforcement is active.

### High: Deployment guide has commands and environment variables that do not match the repo

The guide documents `DB_USER` and `DB_NAME`, but the app reads `DB_USERNAME` and `DB_DATABASE`:

- `new/docs/technical-design/Deployment-Guide.md:28`
- `new/docs/technical-design/Deployment-Guide.md:30`
- `new/code/apps/api/src/database/data-source.ts:51`
- `new/code/apps/api/src/database/data-source.ts:53`

It says migrations run automatically on startup, but `main.ts` only starts Nest; migrations are only run by the standalone migration script:

- `new/docs/technical-design/Deployment-Guide.md:65`
- `new/code/apps/api/src/main.ts:11`
- `new/code/apps/api/src/database/migrate.ts:3`

It also points production execution at `dist/apps/api/main.js`, while the current webpack output path is `apps/api/dist/main.js`:

- `new/docs/technical-design/Deployment-Guide.md:46`
- `new/docs/technical-design/Deployment-Guide.md:62`
- `new/code/apps/api/webpack.config.cjs:5`

These are operator-facing instructions and should be corrected before anyone follows the guide.

### Medium: Runbook and testing standards describe a transaction-backed `inTenant()` helper that does not exist

The runbook and standards say `inTenant()` provisions a schema, runs tests in a rollback sandbox, and interacts with `afterTransactionCommit`:

- `new/docs/technical-design/Runbook.md:32`
- `new/docs/technical-design/Runbook.md:33`
- `new/docs/technical-design/Runbook.md:37`
- `new/docs/technical-design/Runbook.md:40`
- `new/docs/technical-design/Development-Standards.md:30`

Current tests generally define local helpers that only call `TenantContextService.run(...)` and clean schemas manually:

- `new/code/apps/api/src/billing/invoices.service.integration-spec.ts:49`
- `new/code/apps/api/src/patients/patients.service.integration-spec.ts:25`
- `new/code/apps/api/src/accounts/accounts.controller.integration-spec.ts:38`

The docs should either define and introduce the shared helper as real infrastructure, or describe the current pattern accurately.

### Medium: Moved docs contain stale path references

After moving these files into `new/docs/technical-design/`, references such as `docs/superpowers/specs/...` are ambiguous or stale from the new location:

- `new/docs/technical-design/PRD.md:6`
- `new/docs/technical-design/PRD.md:257`
- `new/docs/technical-design/PRD.md:338`
- `new/docs/technical-design/PRD.md:362`

Use repo-root-relative paths consistently, or update relative links to account for the new folder, for example `../superpowers/specs/...`.

## Open Question

Are these documents meant to describe the implemented state today, or the intended target architecture? If they are target-state documents, the deployment guide and runbook still need to remain current-state accurate because operators and contributors will follow them literally.
