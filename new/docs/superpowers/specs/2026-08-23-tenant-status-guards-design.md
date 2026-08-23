# Design Spec: Tenant Status Guards & Purge Logic

## 1. Context and Goals
This spec addresses a cluster of related tasks regarding the tenant lifecycle (`active`, `suspended`, `archived`, `purged`):
- **Task 2.15:** `SubscriptionBillingService` and `PlatformBrandingService` lack status checks.
- **Task 2.16:** `AuthService.changeInitialPassword` bypasses the tenant-status gate.
- **Task 2.17:** Consolidation of non-platform tenant guards.
- **Task 2.28:** Purged `hospitalId` is freely reusable, risking cross-tenant billing leaks.

## 2. Status Guard Consolidation
We will introduce a consolidated status guard in `TenantsService` to be used by all platform-level operations.

### 2.1 `assertValidHospitalTenant`
We will create a helper method on `TenantsService`:
```typescript
async assertValidHospitalTenant(hospitalId: string, allowedStatuses?: string[]): Promise<Tenant>
```
- It will reject `PLATFORM_TENANT_ID`.
- It will fetch the tenant and throw `NotFoundException` if it doesn't exist.
- If `allowedStatuses` is provided, it will throw `BadRequestException` if the tenant's status is not in the list.

### 2.2 Platform Operations (Billing & Branding)
- `PlatformBrandingService` and `SubscriptionBillingService` will adopt this new guard.
- **Rules:** Operations will allow `active` and `suspended` tenants, but block `archived` or `purged` tenants.
- **Rationale:** Super Admins need to be able to manage suspended tenants (e.g., modifying their branding or issuing final bills). Archived tenants are soft-deleted and must be restored to be modified.

### 2.3 Authentication Guard
- In `auth.service.ts`, we will extract an `isTenantInactive(tenant)` helper to deduplicate the `tenant.status === 'suspended' || tenant.status === 'archived'` logic.
- We will apply this check to `changeInitialPassword`, ensuring that hospital staff cannot bypass the login lockout by entering the onboarding flow.

## 3. Purged Tenant ID Reuse (Tombstone Pattern)
Currently, `purgeTenant` deletes the tenant's registry row, freeing up the `hospitalId` for reuse. If reused, the new tenant inherits the purged tenant's billing history.

### 3.1 Status = 'purged'
Instead of deleting the row from the `tenants` table, `purgeTenant` will:
1. Drop the tenant schema and role.
2. Update the tenant row to `status = 'purged'`.
3. Clear `packageCode` or any other strictly active data if necessary, though retaining it is fine.

### 3.2 Provisioning Check
Because the row remains in the `tenants` table, `provisionTenant`'s existing check:
```typescript
const existing = await repository.findOne({ where: { hospitalId: input.hospitalId } });
```
will naturally catch the purged ID and throw a `ConflictException`, safely preventing reuse without requiring a separate `purged_tenant_ids` table.

## 4. Verification Plan
- **Tests:** Update `tenants.service.integration-spec.ts` to assert that `purgeTenant` leaves the row as `purged` and a subsequent `provisionTenant` fails.
- Update `auth.service.integration-spec.ts` to assert `changeInitialPassword` fails for suspended tenants.
- Update `subscription-billing` and `platform-branding` integration specs to assert operations succeed for `suspended` but fail for `archived` tenants.
