# Platform (Super Admin) Console Above Tenants — Design

**Status:** Approved
**Repos:** `new_hospital` (backend, `new/code`) and `new_hospital/frontend` (Nx workspace,
`apps/staff-console`) — this change spans both.

## Problem Statement

The product has two distinct audiences that the system currently conflates into one:

- **Platform/vendor operators** ("Super Admin") who manage the hospitals *on* the platform —
  provisioning tenants, curating the global role and department catalogs.
- **Hospital staff** who work *inside* one hospital — patients, appointments, triage, billing.

Today a Super Admin is not above tenants; it is a resident of one. The dev seed creates the
`superadmin` account inside the `demo` tenant's schema
(`new/code/apps/api/src/database/seed-initial-setup.ts:24-28`), so its JWT carries
`hospitalId: 'demo'`. Three concrete consequences follow:

1. **The platform administrator is hostage to a hospital.** Suspending or deleting `demo` orphans
   the account that administers the platform.
2. **One flat console mixes both altitudes.** `staff-console`'s single sidebar renders global pages
   (Tenants, Global Catalog) directly above tenant-scoped clinical pages (Patients, Appointments,
   Triage), so a Super Admin browsing "Patients" is silently looking at *the demo hospital's*
   patients — presented as though it were a platform-level view.
3. **The conflation has already leaked into the code as workarounds.** The Billing nav entry is
   gated on `billing.manage && !system-admin.tenants.manage`
   (`frontend/apps/staff-console/src/app/shell/app-shell.html:32-33`) purely to hide a tenant screen
   from the Super Admin, and `resolveTenantId()` carries an `admin`-subdomain special case whose own
   comment explains it exists only because the Super Admin lives inside `demo`
   (`frontend/apps/staff-console/src/app/app.config.ts:69-73`).

The `Super Admin` role is already seeded with `isCrossTenant: true` and
`bypassesPermissionChecks: true` (`new/code/apps/api/src/rbac/seed-rbac-catalog.ts:14-21`), but
**nothing in the backend reads `isCrossTenant`** — the flag describes an intent the system does not
implement.

## Solution

Establish a genuine platform altitude above tenants, in three parts:

1. **A reserved platform tenant.** `__platform` is a system tenant that Super Admin accounts live
   in. It is never listed as a hospital, never provisionable by request, and never suspendable.
   Because it reuses the existing tenant/account/JWT machinery unchanged, no parallel authentication
   path is introduced.
2. **A separate platform console in the frontend.** A second shell (`PlatformShell`) over a
   `/platform/*` route tree, with guards that keep each audience inside its own tree. Screens that
   are meaningful at both altitudes (staff accounts, audit trail) are routed into both trees
   pointing at the *same* lazy component.
3. **Subdomain-driven login.** The `admin` subdomain resolves to `__platform`, replacing the
   existing `admin` → `demo` workaround.

**A Super Admin has no access to any tenant's clinical, billing, or operational data.** This is the
decisive scoping choice, and it is what keeps the change small: it is enforced *structurally* rather
than by new authorization code (see Implementation Decisions §2).

## User Stories

1. As a platform operator, I want a console that shows only platform-level pages, so that I am never
   presented with one hospital's clinical data dressed up as a platform view.
2. As a platform operator, I want my account to survive the suspension or deletion of any hospital,
   so that decommissioning a customer cannot lock me out of the platform.
3. As a platform operator, I want the Tenants grid to list only real hospitals, so that the system
   tenant my own account lives in is not presented as a customer.
4. As a platform operator, I want "Staff Accounts" and "Audit Trail" in my console to mean *platform
   admins* and *platform actions*, so that those screens are meaningful at my altitude without
   needing separate implementations.
5. As a hospital staff user, I want the Tenants and Global Catalog pages to be absent from my
   navigation, so that platform administration is not visible from inside a hospital.
6. As a security reviewer, I want a platform operator to be structurally incapable of reading a
   hospital's PHI, so that the platform/tenant boundary does not depend on remembering to add a
   guard to every future screen.
7. As a developer adding a new screen, I want an unambiguous answer to "which console does this
   belong to", so that the altitude of a screen is a routing decision rather than a per-entry
   sidebar conditional.
8. As a platform operator, I want to be taken to the Tenants page on login rather than a hospital
   billing screen, so that my landing page reflects my role.
9. As a developer running the stack locally, I want a documented URL for each audience, so that
   logging in as a Super Admin versus a hospital user is not guesswork.

## Implementation Decisions

### 1. Reserved platform tenant — `__platform`

`PLATFORM_TENANT_ID = '__platform'` becomes a shared backend constant.

- The id passes all three existing validators unchanged — `SAFE_TENANT_ID` in
  `seed-initial-setup.ts:20` and `tenant-provisioning.service.ts:5`, and `SAFE_HOSPITAL_ID` in
  `tenants.service.ts:11`, all `/^[a-z0-9_]+$/`. The resulting schema is `tenant___platform`
  (triple underscore — visually awkward, but valid against `SAFE_SCHEMA_NAME`
  `/^tenant_[a-z0-9_]+$/` in `tenant-connection.service.ts:5`). Accepted as-is; the name appears
  only in internal schema listings.
- **Seed** (`seed-initial-setup.ts`) provisions `__platform` and creates the platform administrator
  with the `Super Admin` role **inside it**. The `demo` tenant remains a normal demo hospital and
  keeps its own administrator, seeded with `Hospital Admin` rather than `Super Admin`.
- **The two accounts get separate credential env vars**, because one account is being split into
  two and reusing one variable set for both would make their identities ambiguous:
  - `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` / `PLATFORM_ADMIN_EMAIL` → the
    `__platform` Super Admin. Defaults stay `superadmin` / `SuperAdmin@123!`, deliberately
    preserving the existing credentials so only the *URL* changes for whoever uses them.
  - The existing `MASTER_ADMIN_*` variables continue to seed the `demo` tenant's administrator,
    with the username default changing to `demoadmin` so it no longer collides with the platform
    account's identity.
- **`listTenants()`** (`tenants.service.ts:101`) excludes `__platform`. This is the single
  authoritative read path for the Tenants grid.
- **`provisionTenant()`** rejects `__platform` as a requested `hospitalId`, as a reserved-name check
  alongside the existing regex validation.
- **Suspend** of `__platform` is refused.

### 2. No new authorization code — isolation is structural

Tenant scope on every authenticated request derives from the JWT's `hospitalId` claim, not from any
client-supplied header (`new/code/libs/tenant-context/src/lib/tenant-context.middleware.ts:19`). A
Super Admin's JWT names `__platform`, so every tenant-scoped query runs `runInTenantSchema` against
the *platform* schema, which contains no patients, encounters, or invoices.

`bypassesPermissionChecks: true` therefore still permits a Super Admin to *call* `/patients` — and
that call returns an empty result from an empty schema, not another hospital's rows. The
platform/tenant data boundary is a property of schema resolution, not a guard that must be
remembered on each new endpoint.

This is a deliberate decision to **not** add per-endpoint platform-user guards. If a future
requirement grants Super Admins read access into tenant data, that is a new capability with its own
design (cross-tenant token exchange plus PHI-access auditing), not an adjustment to this one.

### 3. Frontend — two shells, one app

```
app.routes.ts
├─ /login
├─ ''                                             → audience-aware redirect
├─ '' + PlatformShell   [platformGuard]           ← new
│   ├─ /platform/dashboard        → AdminDashboard     (moved from /dashboard)
│   ├─ /platform/tenants          → TenantList         (moved from /tenants)
│   ├─ /platform/tenants/:id      → TenantDetail       (moved from /tenants/:id)
│   ├─ /platform/catalog          → GlobalCatalogList  (moved from /admin/global-catalog)
│   ├─ /platform/admins           → UserList           (same component as /admin/users)
│   └─ /platform/audit            → AuditList          (same component as /admin/audit)
└─ '' + AppShell        [tenantGuard]             ← existing, nav trimmed
    ├─ /clinical/*, /billing/*
    └─ /admin/users, /admin/audit, /admin/master-data, /admin/billing-settings
```

`AdminDashboard` moves rather than being rebuilt: it is already titled "Super Admin Dashboard" and
its panels are Tenant Growth, Recent Activity, and Recently Provisioned Tenants
(`admin-dashboard.html:5, 61, 167`). It is platform content that happened to live in the shared
tree, and it is already gated on `system-admin.tenants.manage`, so no tenant user loses a page they
could previously reach.

**The bare `''` route becomes audience-aware.** It currently redirects unconditionally to
`/dashboard` (`app.routes.ts:7`), which after the split would land every hospital user on a guard
rejection. It instead resolves per audience — platform → `/platform/dashboard`, tenant → the
tenant default — so the root URL is correct for whoever is logged in, and unauthenticated visitors
still fall through to `authGuard` and `/login`.

- `AuthService` gains `isPlatformAdmin = computed(() => claims()?.hospitalId === PLATFORM_TENANT_ID)`.
  Derived from the **JWT claim**, not from a role name — the backend issues it, so a tenant-resident
  user cannot forge it, and it stays correct if roles are renamed.
- `platformGuard` and `tenantGuard` join the existing functional guards in `@org/auth`. Each rejects
  the wrong audience and redirects to the other tree's landing page rather than to `/login`, so a
  mis-typed URL does not read as a session failure.
- Both shell routes carry `runGuardsAndResolvers: 'always'`, for the route-reuse reason already
  documented at `app.routes.ts:13-16`.
- `AppShell`'s nav drops its Tenants and Global Catalog entries (`app-shell.html:12-31`). The
  `!hasPermission('system-admin.tenants.manage')` clause on the Billing entry (`app-shell.html:32-33`)
  is deleted — it exists only to compensate for the conflation this change removes.
- `PlatformShell` reuses the existing glass/gradient class vocabulary from `styles.css` and the
  `OceanBreezePreset` theme; it is a second shell, not a second design system.

**Shared screens are shared components, not copies.** `UserList` and `AuditList` are routed into
both trees without parameterization: each reads whatever tenant the JWT names, so under a Super
Admin they render platform admins and the platform audit trail automatically. The backend already
scopes both (`accounts.service.ts:64-67` and `audit.service.ts:22` both use `runInTenantSchema`).

### 4. Login and tenant resolution

- `resolveTenantId()` (`app.config.ts:69-73`) maps the `admin` subdomain to `__platform` instead of
  `demo`; the comment describing the `demo` workaround is removed with it.
- The hardcoded post-login redirect to `/billing/invoices` (`login.ts:79`) becomes audience-aware:
  platform → `/platform/dashboard`, tenant → the existing default. This is the same landing pair the
  bare `''` route resolves to, so login and the root URL never disagree about where an audience
  belongs.
- **Local dev URLs:** Super Admin at `http://admin.localhost:4200`; hospital users at
  `http://localhost:4200` (which resolves to `demo` via `environment.tenantId`). All major browsers
  resolve `*.localhost` to `127.0.0.1` without a hosts-file entry.

Login remains one tenant per request: `/auth/login` resolves the account inside the schema named by
`x-tenant-id` (`accounts.service.ts:64-67`). No cross-schema username lookup is introduced, so
platform and tenant username spaces cannot shadow one another.

## Testing Decisions

Per `CLAUDE.md`'s risk-scaling rule, this touches tenant isolation, so the backend gets full
`TenantTestContext`-based integration specs matching the existing codebase pattern:

- The seed provisions `__platform` with the `superadmin` account inside it, and `demo` has no
  Super Admin account.
- `listTenants()` omits `__platform` while listing ordinary tenants.
- `provisionTenant()` rejects `__platform` as a requested `hospitalId`.
- Suspending `__platform` is refused.
- A tenant-resident user's JWT cannot reach platform-schema data (existing isolation guarantee,
  re-asserted against the new tenant).

Frontend unit specs:

- `isPlatformAdmin` is true for a `__platform` claim and false for a tenant claim, including the
  unauthenticated (`null` claims) case.
- `platformGuard` and `tenantGuard`: allow the right audience, and redirect the wrong one to the
  other tree's landing page.
- Post-login redirect branches to `/platform/dashboard` versus the tenant default.
- The bare `''` route resolves to `/platform/dashboard` for a platform claim and to the tenant
  default for a tenant claim.

## Out of Scope

- **Tenant drill-in and impersonation.** A Super Admin cannot view or act within a hospital's data.
  Read-only drill-in and full impersonation were both considered and deferred; either would need a
  cross-tenant token exchange and PHI-access audit trail of its own.
- **Net-new platform pages** — platform dashboard / tenant health, subscription and plan management,
  cross-tenant aggregate reporting. Deferred until the boundary itself exists.
- **A separate `platform-console` Angular app.** Rejected for now: it would duplicate the shell,
  login, theme, and config, and force `UserList`/`AuditList` into a shared library first. The
  two-shell split is revisitable into an app split later if the consoles diverge.
- **Migrating Super Admin accounts in already-seeded databases.** The seed skips accounts that
  already exist and will not relocate `superadmin` out of `demo`; **existing dev databases need a
  wipe-and-reseed.** No production data exists yet, so no migration path is written.
- **Consuming `isCrossTenant` in backend authorization.** The flag stays descriptive. This design
  derives platform identity from the tenant the account lives in, which is simpler and already
  carried in the JWT.
