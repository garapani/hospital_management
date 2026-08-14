# Database Setup and Seeding Scripts

This document describes the available database setup and seeding scripts for initializing the Hospital Management System.

## Prerequisites

Before running any seeding scripts, ensure:

1. PostgreSQL database is running
2. Database connection environment variables are properly configured:
   - `DB_HOST` (default: localhost)
   - `DB_PORT` (default: 5433)
   - `DB_USERNAME` (default: identity_access)
   - `DB_PASSWORD` (default: identity_access_dev_password)
   - `DB_DATABASE` (default: identity_access)

## Available Scripts

### 1. Run Database Migrations

Before seeding, you must run migrations to create the database schema:

```bash
npx nx migrate-tenants api
```

Or directly:
```bash
tsx src/database/migrate.ts
```

### 2. Seed RBAC Catalog (Roles & Permissions)

This script seeds the complete Role-Based Access Control catalog including:
- 14 predefined roles (Super Admin, Hospital Admin, Receptionist, Doctor, Nurse, etc.)
- All permissions for various modules
- Role-permission mappings

**Command:**
```bash
npx nx seed-rbac api
```

Or directly:
```bash
tsx src/database/seed-rbac-catalog-runner.ts
```

### 3. Seed Initial Setup (Platform Admin + Demo Hospital Admin)

This script creates:
- Essential roles (if not already present)
- Essential permissions (if not already present)
- Platform administrator account, in the reserved `__platform` tenant, with the Super Admin role
- Demo hospital administrator account, in the `demo` tenant, with the Hospital Admin role

**Environment Variables (optional) — platform administrator:**
- `PLATFORM_ADMIN_USERNAME` (default: superadmin)
- `PLATFORM_ADMIN_EMAIL` (default: superadmin@hospital.local)
- `PLATFORM_ADMIN_PASSWORD` (default: SuperAdmin@123!)
- `PLATFORM_ADMIN_DISPLAY_NAME` (default: System Administrator)
- `PLATFORM_ADMIN_TENANT_ID` (default: `__platform`)

**Environment Variables (optional) — demo hospital administrator:**
- `MASTER_ADMIN_USERNAME` (default: demoadmin)
- `MASTER_ADMIN_EMAIL` (default: demoadmin@hospital.local)
- `MASTER_ADMIN_PASSWORD` (default: DemoAdmin@123!)
- `MASTER_ADMIN_DISPLAY_NAME` (default: Demo Hospital Administrator)

**Command:**
```bash
npx nx seed-initial-setup api
```

Or directly:
```bash
tsx src/database/seed-initial-setup-runner.ts
```

### 4. Seed Everything (Recommended for Fresh Install)

This runs both RBAC seeding and initial setup in sequence:

```bash
npx nx seed-all api
```

Or directly:
```bash
tsx src/database/seed-rbac-catalog-runner.ts && tsx src/database/seed-initial-setup-runner.ts
```

## Quick Start (Fresh Installation)

For a fresh installation, run these commands in order:

```bash
# 1. Run migrations
npx nx migrate-tenants api

# 2. Seed all data (RBAC + Master Admin)
npx nx seed-all api
```

## Default Credentials

After running the initial setup, two accounts exist:

**Platform administrator** (reserved `__platform` tenant, Super Admin role — reaches the platform
console):
- **Username:** `superadmin` (or value of `PLATFORM_ADMIN_USERNAME`)
- **Password:** `SuperAdmin@123!` (or value of `PLATFORM_ADMIN_PASSWORD`)

**Demo hospital administrator** (`demo` tenant, Hospital Admin role — scoped to that tenant only):
- **Username:** `demoadmin` (or value of `MASTER_ADMIN_USERNAME`)
- **Password:** `DemoAdmin@123!` (or value of `MASTER_ADMIN_PASSWORD`)

⚠️ **IMPORTANT:** Change both default passwords immediately after first login!

In local dev, log in to the platform console at `http://admin.localhost:4200` (the `admin`
subdomain resolves to the `__platform` tenant) and to hospital-facing screens at
`http://localhost:4200`. All major browsers resolve `*.localhost` to `127.0.0.1` with no
hosts-file entry required.

## Idempotency

All seeding scripts are idempotent:
- Running them multiple times won't create duplicate data
- Existing records are skipped
- Safe to run during development or testing

⚠️ **Upgrading an existing database:** because existing records are skipped, re-running this seed
against a database created before the platform-admin/demo-admin split will **not** relocate an
existing `superadmin` account out of the `demo` tenant — that stale account keeps full access to
`demo`'s data. Wipe and reseed the database rather than seeding in place.

## Troubleshooting

### "Super Admin role not found"
Run the RBAC catalog seeding first:
```bash
npx nx seed-rbac api
```

### Database connection errors
Verify your environment variables match your PostgreSQL configuration.

### Permission denied errors
Ensure the database user has sufficient privileges to create tables and insert data.
