# Identity & Access Service — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§5.1, §6, §8 Phase 0)
**Old-system source (field inspiration only, not a parity contract — see PRD line 6):** `old/hospital-management-emr/Code/Components/DanpheEMR.Security/RBAC/*`, `old/hospital-management-emr/Code/Websites/DanpheEMR/Controllers/AccountController.cs`

## Scope

Owns authentication identity (staff and patient accounts), RBAC (roles, permissions, assignments), and JWT issuance for the whole platform. This is a Phase 0 service (§8) — every other service depends on it for auth before it can be built.

**Explicitly out of scope:**
- HR/employee data. Employee Service (Phase 5) references this service's `accountId`, not the reverse — see "Departures from the old model" below for why.
- Frontend nav-menu structure (route display name, ordering, icons). That's the separate frontend repo's concern (PRD §3, §9.4).

## Data model

Postgres, one `tenant_<hospitalId>` schema per hospital (PRD §4). Super Admin accounts live in a platform-level schema, not any tenant schema, since that role isn't pinned to one hospital (§6.2).

| Table | Key fields | Notes |
|---|---|---|
| `accounts` | id, account_type (`staff`\|`patient`), display_name, is_active, failed_login_attempts, locked_until, created_at, updated_at. Staff-only: username, email, password_hash. Patient-only: phone_number, phone_verified_at | Single unified table for both account types — same RBAC/JWT machinery serves both, avoiding duplicate auth code paths. |
| `roles` | id, name, description, priority, bypasses_permission_checks, is_cross_tenant, is_active | See "Departures from the old model" — splits the old `IsSysAdmin` flag into two independent booleans. |
| `permissions` | id, name, description, is_active | Definitions only. No route/URL topology stored here — see "Departures." |
| `role_permissions` | role_id, permission_id | Join table. |
| `account_roles` | account_id, role_id, start_date, end_date, is_active | Carries over the old `UserRoleMap`'s time-bound assignment (temporary role coverage, e.g. a doctor covering OT for a week). |
| `refresh_tokens` (Redis) | token_hash, account_id, hospital_id, issued_at, expires_at, revoked_at, replaced_by | Rotatable and revocable. No old-system precedent — old auth is session-cookie based, not JWT (see "Departures"). |
| OTP codes (Redis, ephemeral) | phone_number, code_hash, expires_at, attempt_count | Not persisted to Postgres — short-lived, doesn't need durable audit storage beyond the attempt counter used for lockout. |

## Departures from the old model

1. **`IsSysAdmin` split into two flags.** The old model used one boolean to mean both "bypasses all permission checks" and implicitly "not scoped to one hospital" (moot in a single-tenant-per-install system). The new RBAC model (PRD §6.1) needs these independently: Hospital Admin bypasses checks *within its own tenant*; only Super Admin is cross-tenant. Hence `bypasses_permission_checks` and `is_cross_tenant` as separate columns.

2. **Route-permission mapping is decentralized, not owned here.** The old `DanpheRoute` table conflated two concerns: which permission gates a URL, and how that URL renders in the nav menu (`DisplayName`, `RouterLink`, `Css`, `ParentRouteId`, `DisplaySeq`). In the new design, Identity & Access owns permission *definitions* only. Each of the other ~35 services declares which permission its own routes require, in its own code (via `@hospital/auth-guards`, PRD §6.2) — Identity & Access never needs to know another service's URL shape. Nav-menu structure belongs entirely to the frontend repo.

3. **No Employee link.** The old `RbacUser.EmployeeId` tied every account directly to an HR record. Employee Service doesn't ship until Phase 5, four phases after Identity & Access — and PRD's G2 forbids cross-service DB access regardless of ship order. The new `accounts` table carries no employee reference at all. When Employee Service ships, it references `accountId` from its own side; Identity & Access stays ignorant of HR data permanently, not just until Phase 5.

4. **Patient authentication via mobile + OTP, not username/password.** The old system is staff-only and has no patient-login precedent to draw from. Mobile+OTP was chosen over password-based login to match expectations set by ABDM and most Indian patient-facing health apps, and because a phone number is already the natural patient identifier at registration.

5. **Refresh-token rotation and account lockout are new, not ports.** The old system has zero brute-force protection (no failed-attempt tracking, no lockout — confirmed by grep, zero hits) and uses ASP.NET session cookies, not JWT. Both gaps matter more in the new design than they did in the old one, because staff/patient login becomes a public-facing endpoint via the API Gateway rather than an on-prem intranet-only login page. Lockout (5 failed attempts → 15min lock) and rotatable/revocable refresh tokens are therefore in Phase 0 scope, not deferred.

## Tenant scoping

- Staff accounts: one row per hospital, in that hospital's `tenant_<hospitalId>` schema (except Super Admin — platform-level schema, can select any `hospitalId` at login/switch time, PRD §6.2).
- Patient accounts: also schema-scoped per hospital. The same phone number used at two different hospitals produces two distinct patient accounts, one per tenant schema — there is no cross-hospital patient identity unification in this PRD's scope (consistent with the PRD §3 non-goal on chain/cross-hospital reporting).

## Auth flows

- **Staff login:** username + password → bcrypt/argon2id verify (fixes the old system's reversible MD5+3DES scheme, PRD §6) → issue access JWT (~15min) + refresh JWT (rotatable, Redis-backed, ~7–30 days).
- **Patient login:** phone + OTP (SMS sent via Notification Service) → verify → same JWT shape, with a `patientId` claim added once Patient Service exists (Phase 1). The `accounts` schema supports the patient account type from Phase 0; the feature activates when Patient Service ships.
- **Both:** 5 failed attempts locks the account for 15 minutes; the API Gateway additionally applies IP-based rate limiting on the login endpoint.

## JWT claims

Per PRD §6.2 (unchanged by this design): `sub` (accountId), `roles[]`, `permissions[]`, `hospitalId`, `patientId` (patient accounts only), `exp`.

## Change propagation

Role/permission/assignment changes publish an `rbac.changed` event on RabbitMQ; every consuming service invalidates its own short-TTL Redis cache of a user's permissions. Unchanged from PRD §6.2 — restated here for completeness since this service is the event's producer.

## Error handling

- Invalid credentials → a single generic message ("invalid username or password" / "invalid code"), never reveals which field was wrong.
- Locked account → a distinct message including the retry-after time.
- Expired or reused refresh token → hard re-authentication required, no silent renewal. Reuse of a refresh token that has already been rotated out revokes its entire rotation chain (theft-detection behavior).

## Testing

- **Contract test on JWT claim shape** — every other service depends on this shape; covered by the existing affected-build contract-test CI gate (PRD §9.4).
- **Cross-tenant leakage test (new requirement, not in PRD as written):** a JWT issued for `tenant_h1` must fail schema resolution against `tenant_h2`. This is the first concrete instance of a broader gap identified in PRD review — no service-level test currently verifies that `@hospital/auth-guards` correctly enforces tenant/patient row-level scoping anywhere in the platform. Recommend this pattern be required for every service, not just Identity & Access, when each service's own spec is written.
