# User & Role Management Screen — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§6.1, §6.2); parent spec: `2026-07-30-identity-access-service-design.md` (as amended for `needs_password_update`, admin-unlock)
**App:** `staff-console` (Angular v18+)

## Scope

Manages *who holds which role* within a hospital — staff account lifecycle and role assignment. Third of the five Phase 0 frontend screens.

**Explicitly not in scope:** editing the role/permission catalog itself (what a "Nurse" or "Doctor" can access). That catalog is platform-level and fixed for Phase 0, per the Identity & Access Service design — seeded via migration, not admin-editable. This screen only assigns *existing* roles to accounts; it does not create roles or change what a role means.

**Access control:** Hospital Admin (own tenant) or Super Admin (any tenant, via the existing cross-tenant context-switch mechanism).

## Route and list view

`/admin/users` — table of staff accounts in the current tenant: username, display_name, email, is_active, current role assignments (shown as tags), locked status (with an "Unlock" action when locked).

## Create staff account

Form: username, email, display_name, plus an admin-set temporary password. On creation, the account is flagged `needs_password_update = true` (per the Identity & Access spec amendment) — the new user must change this password on first login before getting a working session; there's no separate "invite link" flow in Phase 0.

**Error handling:** duplicate username → inline conflict error at the field, not a generic toast.

## Role assignment

Each account has a "Roles" section listing its current `account_roles` rows (role name, start_date, end_date, active/inactive) as a small table, with:

- **Add role:** select from the fixed platform role catalog (read-only reference — see below) plus optional start/end dates, matching the time-bound assignment already designed into `account_roles`.
- **End role:** sets an end date / deactivates the assignment rather than hard-deleting the row, preserving assignment history for audit purposes (consistent with the platform's general soft-state pattern — e.g. tenant suspend, account deactivate — rather than destructive deletes).

A read-only reference view of the role catalog (role name, description, and its fixed access per PRD §6.1's table) is available from this screen so an admin can check what a role actually grants before assigning it, without being able to edit it.

## Deactivate account

Sets `is_active = false` (soft, not deleted) with a lightweight confirmation prompt. Lower blast radius than tenant suspension (locks one person, not an entire hospital), so this doesn't need the heavier confirmation dialog treatment the Tenant Management screen's suspend action gets — a simple inline "are you sure?" is proportionate.

## Unlock account

For an account currently locked (`locked_until` in the future), an "Unlock" action clears the lockout immediately rather than making the user or IT wait out the 15-minute auto-expiry — the ordinary real-world case of an employee locking themselves out.

## Known accepted risk (not handled in Phase 0)

Nothing prevents an admin from removing the last Hospital-Admin-equivalent role assignment in a tenant, which would leave that hospital unable to self-manage its own users. This is accepted for Phase 0 because Super Admin's existing cross-tenant override capability (PRD §6.2) always provides a path to fix it — not a hard lockout, just an inconvenience requiring vendor-side intervention. Worth revisiting if it happens in practice.

## Testing

- E2E: create account with temp password → first login is forced through the password-change flow before reaching a normal session.
- E2E: assign a time-bound role (start/end date), verify it displays correctly and expires as expected.
- E2E: unlock action clears a locked account's status immediately.
- E2E: deactivate account confirmation gating.
