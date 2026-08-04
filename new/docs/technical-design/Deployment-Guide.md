# Deployment Guide

This document outlines the standard deployment procedures for the Hospital Management System Backend.

## 1. Prerequisites
- **Node.js**: v23.10.0 or higher.
- **Package Manager**: pnpm (`npm i -g pnpm`).
- **Database**: PostgreSQL 16.
- **Docker**: For local development and staging environments.

## 2. Infrastructure
The system uses a **Modular Monolith** architecture. This means the entire backend is deployed as a single Node.js process (NestJS) scaling horizontally behind a load balancer, connected to a single shared PostgreSQL instance.

### Postgres Configuration
The application relies heavily on multi-tenancy via Postgres schemas. Ensure the `identity_access` user (or equivalent production user) has permissions to execute DDL (Data Definition Language) commands like `CREATE SCHEMA` because tenant provisioning happens dynamically at runtime.

## 3. Environment Variables
Before starting the application, ensure the `.env` file is populated.

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=identity_access
DB_PASSWORD=identity_access_dev_password
DB_DATABASE=identity_access

# Security
JWT_SECRET=your_super_secret_production_key_here
```

## 4. Building the Application
The project is managed via Nx. To build the production bundle:

```bash
# Install dependencies
pnpm install

# Build the API application
npx nx build api --prod
```
The compiled output will be located in `apps/api/dist` (the webpack `output.path` is relative to
`apps/api/webpack.config.cjs`, not the workspace root).

## 5. Running the Application
### Local Development
To run the application with live-reload:
```bash
# Start the local database
docker-compose -f docker-compose.dev.yml up -d

# Start the NestJS app
npx nx serve api
```

### Production
To run the built artifacts in production:
```bash
node apps/api/dist/main.js
```

There is no production Dockerfile or production `docker-compose.yml` in the repo yet — only
`docker-compose.dev.yml` (local Postgres for development/tests). Building a real container image
is not covered by this guide today.

## 6. Database Migrations
Migrations are **not** run automatically on startup — `main.ts` only calls `NestFactory.create()`
and `app.listen()`; it never calls `dataSource.runMigrations()`.

- **Platform schema** (the `tenants` registry, RBAC catalog tables — see
  `apps/api/src/database/migrations/index.ts`'s `PLATFORM_MIGRATIONS`): must be applied explicitly
  before first boot.
- **Tenant schemas** (`TENANT_MIGRATIONS`): applied automatically as part of provisioning a new
  tenant, via `TenantProvisioningService.provisionTenantSchema()` (called from
  `TenantsService.provisionTenant()`, `POST /tenants`). To re-run tenant migrations in bulk against
  already-provisioned tenants (e.g. after adding a new tenant-schema migration), use the
  `migrate-tenants` Nx target (`pnpm exec nx run api:migrate-tenants`), which loops the `tenants`
  registry table.

**Known gap:** there is currently no working standalone way to invoke platform migrations
(`apps/api/src/database/migrate.ts`) or `migrate-tenants.ts` outside of Jest. Both fail under `tsx`
and under `node --loader ts-node/esm` with a decorator-parsing error that surfaces transitively
through `libs/audit-emitter`'s `@Injectable()`/`@Inject()` decorators (an esbuild/ts-node
tsconfig-resolution issue, not a logic bug — the same migration code paths pass under Jest, e.g.
`tenant-provisioning.service.integration-spec.ts`). Until that tooling gap is fixed, apply platform
migrations by running `dataSource.runMigrations()` from a short-lived Jest test, or investigate a
decorator-safe runner (`ts-node` in CJS mode, `swc`, or a build step) before relying on either
script in a real deployment.

## 7. Scaling
Since the app is stateless (all state is in Postgres/Redis), you can scale the API horizontally by running multiple instances behind a reverse proxy (e.g., Nginx, AWS ALB). Ensure your Redis instance (Phase 5) is shared across all nodes for rate-limiting.
