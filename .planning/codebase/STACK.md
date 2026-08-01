# Technology Stack

**Analysis Date:** 2026-08-01

## Languages

**Primary:**
- TypeScript ~6.0.3 (strict mode) - all application code under `new/code/apps/api/src` and `new/code/libs/*/src`

**Secondary:**
- None detected (single-language Nx/TypeScript monorepo). An `old/` directory exists at repo root containing the legacy Danphe EMR codebase (untouched, reference only).

## Runtime

**Environment:**
- Node.js (version not pinned via `.nvmrc`/`engines` — not detected)
- ESM-first module resolution (`"module": "nodenext"`, `"moduleResolution": "nodenext"` in `new/code/tsconfig.base.json`); source files use `.js` extensions in relative imports (NodeNext convention), verified by `new/code/apps/api/src/verify-esm-interop.ts` and `new/code/apps/api/src/esm-package-type.spec.ts`

**Package Manager:**
- pnpm 11.5.2 (`packageManager` field in `new/code/package.json`)
- Workspace defined in `new/code/pnpm-workspace.yaml`
- Lockfile: present (`new/code/pnpm-lock.yaml`)

## Frameworks

**Core:**
- NestJS 11 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` ^11.x) - HTTP API framework, entry point `new/code/apps/api/src/main.ts`
- Express 5 (`express` ^5.2.1) - underlying HTTP server (via `@nestjs/platform-express`)
- TypeORM ^1.1.0 - ORM/data access layer, data source defined in `new/code/apps/api/src/database/data-source.ts`

**Testing:**
- Jest ~30.3.0 - test runner, root config `new/code/jest.config.ts` and `new/code/jest.preset.js`, per-project configs `new/code/apps/api/jest.config.cts`, `new/code/libs/*/jest.config.cts`
- `@nestjs/testing` ^11.0.0 - Nest testing utilities
- `supertest` ^7.2.2 - HTTP assertion library for controller integration specs (e.g. `new/code/apps/api/src/accounts/accounts.controller.integration-spec.ts`)
- `ts-jest` ^29.4.7 and `@swc/jest` ~0.2.38 - TS transform for Jest (SWC used by default per `.spec.swcrc` files)

**Build/Dev:**
- Nx 23.1.0 - monorepo build orchestration/task graph (`new/code/nx.json`), with `@nx/nest`, `@nx/js`, `@nx/node`, `@nx/web`, `@nx/webpack`, `@nx/jest` plugins
- Webpack 5 (`webpack`, `webpack-cli`, `webpack-dev-server`) - bundling for `apps/api` (`new/code/apps/api/webpack.config.cjs`)
- SWC (`@swc/core`, `@swc-node/register`) - fast TS compilation
- Prettier ^3.8.1 - formatting, config `new/code/.prettierrc` (`{"singleQuote": true}`), ignore list `new/code/.prettierignore`

## Key Dependencies

**Critical:**
- `@nestjs/jwt` ^11.0.2 - JWT issuing/verification for auth (`new/code/apps/api/src/auth/auth.module.ts`)
- `bcryptjs` ^3.0.3 - password hashing
- `class-validator` ^0.15.1 / `class-transformer` ^0.5.1 - DTO validation across all modules' `dto/` folders
- `pg` ^8.22.0 - PostgreSQL driver used by TypeORM
- `reflect-metadata` ^0.2.2 - required for TypeORM/Nest decorator metadata

**Infrastructure:**
- `@nestjs/swagger` ^11.4.6 + `swagger-ui-express` ^5.0.1 - OpenAPI doc generation, served at `/api/docs` (configured in `new/code/apps/api/src/main.ts`)
- `rxjs` ^7.8.0 - reactive primitives used by Nest internals

## Configuration

**Environment:**
- Environment variables read directly via `process.env` (no dotenv/config module detected)
- Key vars: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (`new/code/apps/api/src/database/data-source.ts`), `JWT_SECRET` (`new/code/apps/api/src/auth/auth.module.ts`, defaults to an insecure dev value if unset), `PORT` (`new/code/apps/api/src/main.ts`)
- `.env` file presence: not detected in `new/code/`

**Build:**
- `new/code/tsconfig.base.json` - shared strict TS compiler options (composite project, ES2022 target, decorators enabled)
- `new/code/nx.json` - Nx task pipeline config
- Per-app/lib `tsconfig.json`, `tsconfig.app.json`/`tsconfig.lib.json`, `tsconfig.spec.json` - e.g. `new/code/apps/api/tsconfig.app.json`
- `new/code/apps/api/webpack.config.cjs` - webpack build for the API app

## Platform Requirements

**Development:**
- Docker (Postgres 16 via `new/code/docker-compose.dev.yml`, service `api-postgres`, exposed on host port 5433, mapped to container 5432)
- pnpm workspace install (`new/code/pnpm-workspace.yaml` includes `apps/*`, `libs/*` — verify against file if adding new project roots)

**Production:**
- Not yet defined — `new/code/apps/api/src/main.ts` explicitly notes "This is not a production server yet!"
- No CI/deployment config beyond `new/code/.github` (contents not yet analyzed as deployment pipeline)

---

*Stack analysis: 2026-08-01*
