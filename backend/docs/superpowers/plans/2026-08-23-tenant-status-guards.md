# Tenant Status Guards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize tenant status checks and fix purge logic so that inactive tenants are properly protected and purged IDs cannot be reused.

**Architecture:** We will introduce a shared `assertValidHospitalTenant` guard in `TenantsService`, migrate billing and branding services to use it (allowing `suspended` but blocking `archived`/`purged`), deduplicate auth status checks with `isTenantInactive`, and change `purgeTenant` to update status to `purged` instead of deleting the registry row.

**Tech Stack:** NestJS, TypeORM, TypeScript, Jest

## Global Constraints

- Run tests in tenant isolation contexts (`TenantTestContext`).
- Adhere to the no-amend commit rule.
- Do not bypass `runInTenantSchema` for domain operations.

---

### Task 1: Centralize Guard in TenantsService

**Files:**
- Modify: `new/code/apps/api/src/tenants/tenants.service.ts`
- Modify: `new/code/apps/api/src/tenants/tenants.service.integration-spec.ts`

**Interfaces:**
- Produces: `assertValidHospitalTenant(hospitalId: string, allowedStatuses?: string[]): Promise<Tenant>`

- [ ] **Step 1: Write the failing tests**
Add test cases in `tenants.service.integration-spec.ts` for `assertValidHospitalTenant` rejecting platform tenant, rejecting not found, rejecting unauthorized status, and allowing authorized status.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="tenants.service.integration-spec"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Implement `assertValidHospitalTenant` in `TenantsService`. Replaces `loadMutableTenant` where applicable.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="tenants.service.integration-spec"`
Expected: PASS

- [ ] **Step 5: Commit**
`git add new/code/apps/api/src/tenants/tenants.service.ts new/code/apps/api/src/tenants/tenants.service.integration-spec.ts`
`git commit -m "refactor(tenants): extract shared assertValidHospitalTenant guard"`

---

### Task 2: Apply Guard to Platform Billing

**Files:**
- Modify: `new/code/apps/api/src/platform-billing/subscription-billing.service.ts`
- Modify: `new/code/apps/api/src/platform-billing/subscription-billing.service.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantsService.assertValidHospitalTenant`

- [ ] **Step 1: Write the failing tests**
Update integration specs to verify that `subscribe`, `issueInvoice`, etc. succeed for `suspended` tenants, but fail for `archived` or `purged` tenants.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="subscription-billing.service.integration-spec"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Inject `TenantsService` if not already, and replace `tenantRow` logic with `assertValidHospitalTenant(tenantId, ['active', 'suspended'])`. Update `PackagesService.getTenantPackageCode` usage if needed.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="subscription-billing.service.integration-spec"`
Expected: PASS

- [ ] **Step 5: Commit**
`git commit -m "fix(platform-billing): block operations on archived/purged tenants"`

---

### Task 3: Apply Guard to Platform Branding

**Files:**
- Modify: `new/code/apps/api/src/platform-branding/platform-branding.service.ts`
- Modify: `new/code/apps/api/src/platform-branding/platform-branding.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantsService.assertValidHospitalTenant`

- [ ] **Step 1: Write the failing tests**
Update integration specs to verify that `upsertBranding`, `uploadLogo`, `removeLogo` succeed for `suspended` but fail for `archived` or `purged` tenants.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="platform-branding"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Refactor `assertBrandableTenant` to call `TenantsService.assertValidHospitalTenant(hospitalId, ['active', 'suspended'])`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="platform-branding"`
Expected: PASS

- [ ] **Step 5: Commit**
`git commit -m "fix(platform-branding): block operations on archived/purged tenants"`

---

### Task 4: Deduplicate Auth Status Check

**Files:**
- Modify: `new/code/apps/api/src/auth/auth.service.ts`
- Modify: `new/code/apps/api/src/auth/auth.service.integration-spec.ts`

**Interfaces:**
- Consumes: `TenantsService.getTenant`

- [ ] **Step 1: Write the failing tests**
Add test in `auth.service.integration-spec.ts` to ensure `changeInitialPassword` fails with 401/403 for `suspended` and `archived` tenants.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="auth.service.integration-spec"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
Extract `private isTenantInactive(tenant: Tenant | null): boolean` checking for `suspended` | `archived` | `purged`. Apply this in `login`, `refresh`, and importantly in `changeInitialPassword` (by fetching the tenant first).

- [ ] **Step 4: Run test to verify it passes**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="auth.service.integration-spec"`
Expected: PASS

- [ ] **Step 5: Commit**
`git commit -m "fix(auth): block changeInitialPassword for inactive tenants"`

---

### Task 5: Refactor Purge Logic to Tombstone

**Files:**
- Modify: `new/code/apps/api/src/tenants/tenants.service.ts`
- Modify: `new/code/apps/api/src/tenants/tenants.service.integration-spec.ts`

- [ ] **Step 1: Write the failing tests**
Update `tenants.service.integration-spec.ts`. Assert that after `purgeTenant`, the tenant's registry row exists with `status === 'purged'`. Assert that a subsequent `provisionTenant` with the same ID fails with `ConflictException`.

- [ ] **Step 2: Run test to verify it fails**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="tenants.service.integration-spec"`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**
In `purgeTenant`, change `manager.getRepository(Tenant).remove(tenant)` to update `tenant.status = 'purged'` and `save()`. (Note: Ensure the entity type allows 'purged' as a valid status, update `Tenant` entity status column if needed).

- [ ] **Step 4: Run test to verify it passes**
Run: `cd new/code && CI=true pnpm exec nx run api:test -- --testPathPatterns="tenants.service.integration-spec"`
Expected: PASS

- [ ] **Step 5: Commit**
`git commit -m "fix(tenants): soft-delete registry row on purge to prevent ID reuse"`
