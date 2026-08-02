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
DB_USER=identity_access
DB_PASSWORD=identity_access_dev_password
DB_NAME=identity_access

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
The compiled output will be located in `dist/apps/api`.

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
node dist/apps/api/main.js
```

## 6. Database Migrations
Migrations for standard tables are executed automatically on startup.
However, **Tenant-Specific Tables** are provisioned dynamically when a new tenant is created via the `AccountsService.provisionTenantSchema()` workflow.
Ensure your deployment does not block dynamic schema creation.

## 7. Scaling
Since the app is stateless (all state is in Postgres/Redis), you can scale the API horizontally by running multiple instances behind a reverse proxy (e.g., Nginx, AWS ALB). Ensure your Redis instance (Phase 5) is shared across all nodes for rate-limiting.
