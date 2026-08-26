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
The application relies heavily on multi-tenancy via Postgres schemas. Ensure the `hospital_db_user` user (or equivalent production user) has permissions to execute DDL (Data Definition Language) commands like `CREATE SCHEMA` because tenant provisioning happens dynamically at runtime.

## 3. Environment Variables
Before starting the application, ensure the `.env` file is populated.

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5433
DB_USERNAME=hospital_db_user
DB_PASSWORD=hospital_db_password
DB_DATABASE=hospital_db

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
Two supported paths:

**1. Containerized (recommended)** — the repo ships a production `Dockerfile` and
`docker-compose.prod.yml` (Postgres + Redis + MinIO + API, with a one-shot `migrate` service):

```bash
# Build the API image (devDependencies are kept on purpose: the migrate service runs the
# migration runners via the swc-node loader).
docker compose -f docker-compose.prod.yml build api

# Apply platform + tenant migrations (idempotent; run once per deployment, and again whenever
# a new migration is added).
docker compose -f docker-compose.prod.yml run --rm migrate

# Start the stack.
docker compose -f docker-compose.prod.yml up -d
```

**2. Bare `node`** — after `pnpm exec nx build api`, run the compiled bundle directly:
```bash
node apps/api/dist/main.js
```

Either way, run migrations explicitly first (see §6) — they never run automatically on startup.

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

**Resolved (2026-08-20):** both standalone runners work outside Jest via the SWC-based nx targets or
directly through the swc-node loader:

```bash
# Platform migrations (public schema: tenants registry, RBAC catalog)
pnpm exec nx run api:migrate
# Tenant migrations (every already-provisioned tenant schema)
pnpm exec nx run api:migrate-tenants
```

**Seeds are separate from migrations.** Since the 2026-08-27 squash (Development-Standards.md
§108), migrations are schema-only — every fixed catalog row (RBAC roles/permissions, the SaaS
packages, the per-tenant system ledger accounts) is an idempotent seed script. A fresh platform
DB needs `seed-all`; a platform that only ever runs `migrate` has an empty catalog and cannot
provision tenants (`tenants.packageCode` references `packages`):

```bash
# Everything: migrate + seed-rbac + seed-packages + seed-initial-setup + seed-ledger-accounts
pnpm exec nx run api:seed-all
# Or the individual steps
pnpm exec nx run api:seed-rbac
pnpm exec nx run api:seed-packages
pnpm exec nx run api:seed-initial-setup
# Backfill the system ledger accounts into already-provisioned tenant schemas
pnpm exec nx run api:seed-ledger-accounts
```

Tenant provisioning seeds the ledger accounts automatically for NEW tenants (inside
`provisionTenantSchema`), so the `seed-ledger-accounts` target is only needed for schemas that
predate the squash.

The same two scripts are what the containerized `migrate` service runs. See
`Development-Standards.md` §26 for why the runners must exit explicitly (the swc-node loader's IPC
pipes and data-source.ts's pool-monitor `setInterval` keep the event loop alive otherwise).

## 7. Scaling
Since the app is stateless (all state is in Postgres/Redis), you can scale the API horizontally by running multiple instances behind a reverse proxy (e.g., Nginx, AWS ALB). Ensure your Redis instance (Phase 5) is shared across all nodes for rate-limiting.

## 8. Backup Configuration

Nightly backups run via `scripts/backup-db.sh`, which `pg_dump`s the whole database (every tenant
schema plus `public`, since it's all one Postgres database) into one custom-format (`-Fc`) file,
validates it, gzips it, and uploads it to an S3-compatible bucket. See `Runbook.md` "Restoring
from Backup" for how to use the resulting dump. **RPO is up to 24 hours** — backups are nightly
only; there is no continuous WAL archiving/point-in-time recovery yet (a known, deliberately
deferred gap, not an oversight).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COMPOSE_FILE` | `docker-compose.dev.yml` | Compose file the Postgres service lives in (backup script default; set to `docker-compose.prod.yml` on a prod host). |
| `POSTGRES_SERVICE` | `api-postgres` | Compose service name to `docker exec` into (backup script default; `hospital-postgres` on prod). |
| `POSTGRES_USER` | `hospital_db_user` | Matches `DB_USERNAME`. |
| `POSTGRES_DB` | `hospital_db` | Matches `DB_DATABASE`. |
| `BACKUP_DIR` | `./backups` | Local working directory for dump files before/after upload. |
| `RETENTION_DAYS` | `30` | Local dump files older than this are deleted after a successful run. |
| `S3_BUCKET` | *(unset)* | Target bucket. **If unset, the script runs in dry-run mode** — it still dumps, validates, and gzips locally, but skips the upload step and logs a warning instead. |
| `S3_PREFIX` | `postgres-backups` | Key prefix inside the bucket. |

### One-time setup

1. Create an S3-compatible bucket in an India region (e.g. AWS S3 `ap-south-1`) — required by
   `PRD.md` §10's data-residency rule.
2. Configure a bucket lifecycle rule expiring objects under `S3_PREFIX` after 30 days (matches
   `RETENTION_DAYS`) — this is what actually prunes the *offsite* copies; the script only prunes
   its own local working directory. Both use the same 30-day figure but are two independent
   mechanisms — change both if the retention window changes.
3. Provide AWS credentials with write access to that bucket via the standard `aws-cli` credential
   chain (env vars, `~/.aws/credentials`, or an instance role) — not through this repo's `.env`
   file, since that's for the application's own runtime config, not ops tooling credentials.
4. Add a nightly cron entry on the host running the compose stack:
   ```cron
   0 2 * * * cd /path/to/new_hospital/new/code && S3_BUCKET=your-bucket-name ./scripts/backup-db.sh >> /var/log/backup-db.log 2>&1
   ```

### Troubleshooting: "out of shared memory" / `max_locks_per_transaction`

`pg_dump` takes a lock on every table it's about to dump, all in one transaction — at a large
enough schema count (many tenant schemas, or a lot of stray/leftover schemas on a shared dev
instance) this can exceed Postgres's default `max_locks_per_transaction` (64) and fail with
`ERROR: out of shared memory` / `HINT: You might need to increase max_locks_per_transaction.` At
the PRD's target of 10-20 tenant schemas this isn't expected to trigger, but if it does: raise
`max_locks_per_transaction` in `postgresql.conf` (or via `ALTER SYSTEM SET
max_locks_per_transaction = <value>;`) and restart Postgres — this setting only takes effect on
restart, `pg_reload_conf()` is not enough.

## 9. Production Environment: the newgenworks.in server

**This is a shared VPS, not a dedicated host.** Hostname `srv775724`, Debian 12 (bookworm), 2
vCPU / 8GB RAM. Alongside this project it also runs several unrelated projects for other clients
(`bhakti`, `devtoolshub`, `dots_boxes`, `newgenworks_db`/`newgenworks_mongo_db`, `prompthub`,
`telugu_sticker_proj`) as their own Docker containers on the same box. **Any change here —
restarting containers, reloading nginx, touching shared resources — has blast radius beyond this
project.** Check `docker ps -a` before assuming a port/container name is free.

### Access

- SSH: `ssh newgenworksadmin@<host>` (password auth) for day-to-day work — this user owns
  `~/hospital/` and is in the `docker` group (no `sudo` needed for any command in this section).
  A `root@<host>` login also exists for emergencies.
- **Actual credentials (SSH password, root password, and everything in the app's `.env` — DB
  password, `JWT_SECRET`, `MASTER_ADMIN_PASSWORD`, `PLATFORM_ADMIN_PASSWORD`,
  `OBJECT_STORAGE_ACCESS_KEY`/`SECRET_KEY`) are intentionally not in this doc or anywhere in git
  history** — see this repo's root `.gitignore` (`.env*`, `*secret*`, `*credential*` patterns).
  They're tracked outside the repo (ask the project owner for the current copy); the server's own
  `~/hospital/backend/new/code/.env` is the authoritative live copy for the app's runtime config.

### Layout on the server

```
~/hospital/
├── backend/                  # this repo, git clone of hospital_management (backend)
│   └── new/code/              # the actual Nx workspace — docker-compose.prod.yml, .env, Dockerfile live here
├── frontend-src/              # git clone of hospital_management_frontend — source, not served directly
├── frontend-dist/browser/     # built static output — THIS is what nginx actually serves
├── nginx-hospital-http.conf, nginx-hospital-https.conf,
│   nginx-demo-admin-http.conf, nginx-demo-admin-https.conf   # vhost configs (see below)
```

`frontend-src` and `frontend-dist` are deliberately separate: the box has no Node.js/pnpm on the
host and no frontend `Dockerfile` in the repo, so the build runs in a throwaway container and only
its *output* gets published to the directory nginx reads from (see "Deploying the frontend"
below).

### Networking: existing reverse proxy, not a new one

A pre-existing `nginx-docker` stack (its own compose project, unrelated to this repo) runs the
box's single nginx container (`docker ps` shows it as `nginx`) and terminates TLS for every domain
on the box via Let's Encrypt certs at `/etc/letsencrypt/live/<domain>/`. This project's containers
join its `hospital-network` Docker bridge network (created by this repo's own
`docker-compose.prod.yml`) so nginx can reach `hospital-api` by container name — there is no
separate nginx setup to deploy for this project, only vhost `.conf` files (already in place at
`~/hospital/nginx-*.conf`, mounted into the shared nginx container).

Three domains all point at the same deployment:

| Domain | Serves |
|---|---|
| `hospital.newgenworks.in` | `frontend-dist/browser` (static) + `/api/` → `hospital-api:3000` |
| `demo.newgenworks.in` | same as above |
| `admin.newgenworks.in` | same as above (platform-admin routes live in the same SPA bundle) |

**Gotcha — nginx caches the upstream IP.** `proxy_pass http://hospital-api:3000/api/;` is a static
hostname, not a variable, so nginx resolves it once per worker process and does not notice when
`hospital-api`'s container is recreated (new IP on `hospital-network`). Every backend redeploy
that recreates the `hospital-api` container needs a follow-up
`docker exec nginx nginx -s reload` or the site 502s until nginx is restarted for an unrelated
reason. This is graceful (doesn't drop other domains' connections) but still touches the box's
one shared nginx instance — reload, don't restart the container.

### Deploying the backend

```bash
ssh newgenworksadmin@<host>
cd ~/hospital/backend && git pull --ff-only origin main
cd new/code

# Rebuild the API image
docker compose -f docker-compose.prod.yml build api

# Bring up dependencies first, then migrate (idempotent — safe to rerun)
docker compose -f docker-compose.prod.yml up -d postgres redis minio
docker compose -f docker-compose.prod.yml run --rm migrate

# Bring up the rest (api, prometheus)
docker compose -f docker-compose.prod.yml up -d

# Required follow-up — see the nginx caching gotcha above
docker exec nginx nginx -s reload
```

`docker-compose.prod.yml` also runs `minio` and `prometheus` (added since this project's first
deploy here) — `minio` needs `OBJECT_STORAGE_ACCESS_KEY`/`OBJECT_STORAGE_SECRET_KEY` set in `.env`
(the API throws at boot without them in `NODE_ENV=production` —
`libs/object-storage/src/lib/object-storage.service.ts`); the same values also drive `minio`'s
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` (one source of truth, see `docker-compose.prod.yml`).
`prometheus` publishes `:9090` to the host with no auth in front of it — restrict this
(firewall/VPN) if that's a concern on a box with other tenants' traffic.

### Deploying the frontend

No Node.js on the host and no frontend `Dockerfile` in the repo — build inside a throwaway
container, then publish just the output:

```bash
ssh newgenworksadmin@<host>
cd ~/hospital/frontend-src && git pull --ff-only origin main

docker run --rm -v ~/hospital/frontend-src:/workspace -w /workspace node:22-bookworm-slim sh -c '
  corepack enable &&
  pnpm install --frozen-lockfile &&
  pnpm exec nx build staff-console --configuration=production
'

# rsync is not installed on this host — plain cp, no --delete (stale old chunk files are
# harmless clutter, not a correctness issue: index.html always references the current build's
# hashed filenames)
cp -r ~/hospital/frontend-src/dist/apps/staff-console/browser/. ~/hospital/frontend-dist/browser/
```

No nginx reload needed here — static files are served straight off the bind-mounted directory.

**The frontend repo's deploy key on this server is read-only.** A fix discovered/made on the
server (e.g. during a build) cannot be pushed from here — `git push` fails with "read only". Apply
the fix locally in a full clone with write access (e.g. `~/…/new_hospital/frontend` on a dev
machine) instead, push from there, then `git pull --ff-only` on the server to pick it up.

### Rollback

- **Frontend:** each deploy leaves the previous build at `~/hospital/frontend-dist.bak-<timestamp>`
  before publishing (make one before overwriting, if the deploy script/session didn't already);
  restore with the same `cp -r` pattern in reverse.
- **Backend:** `git checkout <previous-commit>` in `~/hospital/backend`, rebuild the `api` image,
  restart — migrations are additive/idempotent so no down-migration path exists; a bad migration
  needs a manual fix-forward, not a rollback.

### Known one-off issues already fixed upstream

- `frontend` repo's `pnpm-workspace.yaml` needed `'@swc/core': true` added to `allowBuilds` — a
  fresh install on a recent pnpm (no `packageManager` pin in that repo) blocks on pnpm's
  build-script approval policy otherwise. Fixed in commit `d1ec131`; only relevant if a very old
  frontend commit is ever checked out fresh.
