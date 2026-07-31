# Accounts & Roles Admin API — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§6)
**Parent spec:** `new/docs/superpowers/specs/2026-07-30-identity-access-service-design.md`
**Prior implementation:** `new/docs/superpowers/plans/2026-07-30-identity-access-core-auth.md` (Tasks 1-9, complete) — this plan builds directly on `AccountsService`, `TenantConnectionService`, the RBAC catalog, and `AuthService`/`AuthController` it produced.

## Scope

Adds the admin-facing HTTP API for account and role-assignment management that the core-auth plan explicitly deferred: create staff account, list/deactivate/reactivate accounts, admin unlock, and assign/revoke role assignments (time-bound, via the existing `account_roles` table). Also closes a gap the core-auth plan left as a documented placeholder: `AuthService.login` returning `permissions: []` unconditionally, because no permission was ever seeded against any role.

**Explicitly out of scope (deferred to later plans, not silently dropped):**
- Forced password-change flow (`needs_password_update` → restricted-scope token → password-change endpoint). This account-creation flow sets the flag; enforcing it is a login-flow concern, cleaner as its own plan alongside refresh-token rotation.
- Refresh-token rotation/revocation (Redis-backed, per the parent design spec's Auth flows section). Separate concern from admin CRUD.
- The `rbac.changed` RabbitMQ event. No message broker exists anywhere in this repo yet — same blocker the core-auth plan already documented for this exact item.
- Patient accounts, OTP auth — unchanged from the core-auth plan's deferrals.

## Permission model

One new platform-level permission, `identity.accounts.manage`, granted to Hospital Admin and Super Admin only (per PRD §6.1's existing row: both already have "full access" to Identity & Access at the service level — this plan is the first to need that expressed as an actual `permissions`/`role_permissions` row rather than just a PRD table cell).

Deliberately a single coarse permission, not split by action (create vs. deactivate vs. role-assign). Nothing in the PRD or current codebase distinguishes finer trust levels yet, and every caller today (Hospital Admin, Super Admin) needs every action anyway — splitting further is speculative and cheap to do later (one migration, no code-shape change) once a real need appears.

Enforcement reuses the existing `@hospital/auth-guards` library unchanged: `PermissionGuard` + `@RequirePermission('identity.accounts.manage')` on every new route. `PermissionGuard` reads the `x-permissions` header — set by the future API Gateway in production, set directly by tests today (the same pattern `AuthController`'s existing tests already use for `x-tenant-id`, since no Gateway exists yet).

**Closing the `permissions: []` gap:** `AuthService.login` currently hardcodes an empty permissions array (documented as an intentional placeholder in the core-auth plan). This plan adds `AccountsService.getPermissionNamesForRoles(roleIds: string[]): Promise<string[]>` — a platform-level lookup through `role_permissions`/`permissions` via the plain `DataSource`, mirroring the existing role-name resolution pattern in `findByUsernameWithRoles` — and wires its result into the JWT payload's `permissions` claim.

## Data model changes

New migration, `apps/identity-access/src/database/migrations/<ts>-seed-accounts-manage-permission.ts`, platform-level (`public` schema, alongside `roles`/`permissions`/`role_permissions`):
- Insert one `permissions` row: `identity.accounts.manage`.
- Insert two `role_permissions` rows linking it to the `Hospital Admin` and `Super Admin` role ids.

No new tables — `accounts` and `account_roles` (Task 5 of the core-auth plan) already have every column this plan's endpoints need (`isActive` on both, `startDate`/`endDate` on `account_roles`, `needsPasswordUpdate`/`failedLoginAttempts`/`lockedUntil` on `accounts`).

## API

All routes under `/accounts`, all requiring `identity.accounts.manage`:

| Route | Behavior |
|---|---|
| `POST /accounts` | Create a staff account. Body: `username`, `email`, `displayName`, `password`, `roleName`. Always sets `needsPasswordUpdate=true` (temp password, per the parent design spec) — extends `AccountsService.createStaffAccount` with a `needsPasswordUpdate` input rather than a new method. |
| `GET /accounts` | List accounts in the current tenant. `?limit=&offset=` (defaults 50/0) — no cursor pagination; tenant account counts don't warrant it yet. |
| `GET /accounts/:id` | Fetch one account with its active roles. |
| `PATCH /accounts/:id/deactivate` | `isActive=false`. Idempotent — already-inactive is a `200` no-op, not an error. |
| `PATCH /accounts/:id/reactivate` | `isActive=true`. Idempotent, same as above. |
| `PATCH /accounts/:id/unlock` | Admin unlock. Thin controller wrapper over the **existing** `AccountsService.resetFailedLogins` — no new data-layer method, it already clears both `failedLoginAttempts` and `lockedUntil`. |
| `POST /accounts/:id/roles` | Assign a role. Body: `roleName`, optional `startDate`/`endDate`. New `AccountsService.assignRole`. `404` if `roleName` doesn't exist in the platform `roles` table. `409` if the account already holds an active assignment of that same role (the one real validation rule this plan adds — silent duplicate-assignment is a data-integrity gap the parent design spec doesn't address). |
| `DELETE /accounts/:id/roles/:accountRoleId` | Revoke a role assignment — soft delete (`isActive=false` on the `account_roles` row, never a hard delete, preserving history). New `AccountsService.revokeRoleAssignment`. Idempotent on an already-inactive assignment. |

All `:id`/`:accountRoleId` routes: `404` if the referenced row doesn't exist (or isn't in the current tenant schema).

## Audit logging

First real consumer of `@hospital/audit-emitter`, built but unused by any app so far. `AuditEmitterModule`'s `AuditSubscriber` registers against `Account`/`AccountRole` on the shared `DataSource` (both already TypeORM entities — subscriber registration needs no entity changes). `AUDIT_EVENT_PUBLISHER` binds to a new `LoggingAuditEventPublisher` (identity-access-local, not part of the shared library) that writes the `AuditEvent` as structured JSON via `console.log` — a deliberate stub, since no real transport (broker, Audit Service) exists yet; swapping it for one later is a one-line DI rebind, not a design change.

Every mutation this plan's endpoints make (create, deactivate, reactivate, unlock, assign, revoke) therefore produces an audit event carrying `changedByAccountId` (from the `x-account-id` header, same Gateway-simulation pattern as `x-tenant-id`/`x-permissions`) and `hospitalId` (current tenant), with no additional code in the endpoints themselves — the subscriber fires on the underlying TypeORM insert/update regardless of which service method triggered it.

## Testing

Same TDD pattern as the core-auth plan: one `.integration-spec.ts` per new service method and controller route, against the real Docker Compose Postgres, red-green-implement.

Plus one cross-cutting negative test, the permission-gating equivalent of the core-auth plan's cross-tenant isolation test (Task 9): an account holding only `Doctor` (no admin role, hence no `identity.accounts.manage` permission) gets `403` on every new route. This is the first real exercise of `PermissionGuard` in the codebase — worth the same "prove it can't be bypassed" rigor the tenant-isolation test gave the schema boundary.

## Self-review notes

- **Placeholder scan:** no TBD/TODO left; the stub `LoggingAuditEventPublisher` and single-permission model are explicit, reasoned decisions (see above), not silent gaps.
- **Internal consistency:** permission enforcement uses the exact mechanism (`PermissionGuard`, header-based `RequestContext`) the parent design spec and existing `AuthController` tests already establish — no new authorization pattern introduced.
- **Scope check:** deliberately excludes forced-password-change and refresh-token rotation (login-flow concerns) and `rbac.changed` (no broker) — each is a clean, independent follow-up plan, not entangled with this one.
- **Ambiguity check:** idempotency behavior (deactivate/reactivate/unlock/revoke all `200` no-op on repeat) and the one `409` case (duplicate active role assignment) are stated explicitly so the implementation plan doesn't have to invent error-handling behavior task-by-task.
