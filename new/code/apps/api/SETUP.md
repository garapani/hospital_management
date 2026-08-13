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

### 3. Seed Initial Setup (Master Admin Account)

This script creates:
- Essential roles (if not already present)
- Essential permissions (if not already present)
- Master admin account with Super Admin role

**Environment Variables (optional):**
- `MASTER_ADMIN_USERNAME` (default: superadmin)
- `MASTER_ADMIN_EMAIL` (default: superadmin@hospital.local)
- `MASTER_ADMIN_PASSWORD` (default: SuperAdmin@123!)
- `MASTER_ADMIN_DISPLAY_NAME` (default: System Administrator)

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

After running the initial setup, you can login with:

- **Username:** `superadmin` (or value of `MASTER_ADMIN_USERNAME`)
- **Password:** `SuperAdmin@123!` (or value of `MASTER_ADMIN_PASSWORD`)

⚠️ **IMPORTANT:** Change the default password immediately after first login!

## Idempotency

All seeding scripts are idempotent:
- Running them multiple times won't create duplicate data
- Existing records are skipped
- Safe to run during development or testing

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
