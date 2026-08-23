# Patient Portal — Design

**Status:** Proposed (needs approval before any implementation)
**Repos:** `new_hospital` (backend, `new/code`) and a **new** frontend app under
`new_hospital/frontend` (`apps/patient-portal`) — this is a distinct public-facing surface from
`apps/staff-console`, not an addition to it (see Implementation Decision 4).

## Problem Statement

There is no patient-facing surface in the system today. Patients are purely staff-managed records:
`Patient` (`apps/api/src/patients/entities/patient.entity.ts:6-12`) has no relation to `Account` at
all — no `accountId`, no FK either direction. `Account.accountType` already declares a
`'patient'` variant (`apps/api/src/accounts/entities/account.entity.ts:11`) but it is dead code:
`AccountsService.create()` hardcodes `accountType: 'staff'`
(`apps/api/src/accounts/accounts.service.ts:135`), and nothing anywhere creates or links a
patient-typed account. Confirmed with the user: the target scope is (1) read-only access to a
patient's own records, (2) appointment booking, (3) online bill payment, (4) secure
patient-provider messaging, with a new patient account type as the auth model (not magic links).

That is four largely independent capabilities sitting on one shared foundation (patient identity +
auth + self-scoped data access) with very different risk profiles — payment touches money and a
currently-nonexistent payment-gateway integration, booking needs a real slot model that doesn't
exist yet, messaging is a wholly new domain. Building all four in one pass would violate this
repo's "smallest valuable slice, confirm scope" convention (used for every other multi-part backlog
item — see 2.8/2.9/2.10 in `claude-code-tasks.md`). This spec proposes the foundation plus the
read-only slice as **Phase 1**, and scopes (without designing in implementation detail) Phases 2–4
as separate follow-on specs, each gated on its own confirmation.

## Solution

**Phase 1 — Foundation + read-only records** (this spec covers this phase in full):
- Activate `Account.accountType = 'patient'` as a real, distinct login path.
- Link a patient account to exactly one `Patient` record.
- Patient login issues a JWT scoped to that patient — no RBAC roles/permissions, a structurally
  narrower guard instead (see Implementation Decision 2).
- Read-only views: upcoming/past appointments, invoices, prescriptions, lab/radiology results.
- New frontend app, public-facing, no staff RBAC-menu machinery.

**Phase 2 — Appointment booking** (deferred, own scoping pass): blocked on a real
availability/slot model — today's booking capacity check is staff-only ad-hoc double-booking
detection (`appointments.service.ts:72-88`) plus a hardcoded 16-slot/day assumption
(`:165-186`), not something a patient can safely self-serve against without overbooking risk.

**Phase 3 — Bill payment** (deferred, own scoping pass): **zero payment-gateway integration
exists anywhere in this codebase** (confirmed by grep — no Razorpay/Stripe/PayU/Paytm/Braintree
references). Vendor selection is a business/compliance decision (PCI-DSS scope, settlement,
India-market support), not an engineering default I should silently pick.

**Phase 4 — Secure messaging** (deferred, own scoping pass): a wholly new domain (threads,
delivery, notification fan-out) with no existing analog in this codebase to extend.

## User Stories (Phase 1)

1. As a patient, I want to log in with my own credentials, so that I don't depend on a hospital
   staff member to look anything up for me.
2. As a patient, I want to see only my own appointments, invoices, prescriptions, and results, so
   that another patient's data is never reachable through my account no matter what I request.
3. As front-desk staff, I want to issue a patient a portal invite tied to their existing chart, so
   that portal identity is anchored to a real `Patient` record rather than open self-registration
   that could be claimed by the wrong person.
4. As a patient, I want to set my own password from an invite link before I can log in, so that
   staff never see or choose my credential.
5. As a patient, I want my upcoming appointments and latest lab/radiology results in one place, so
   that I don't have to call the hospital to ask.
6. As a security reviewer, I want a patient account to be structurally incapable of reading another
   patient's — or any hospital staff's — data, so the boundary doesn't depend on remembering a
   filter on every future endpoint.
7. As a developer, I want patient-portal endpoints to live in their own namespace with their own
   guard, so a future staff-endpoint change can't accidentally widen what a patient account can
   reach.

## Implementation Decisions

### 1. Patient ↔ Account link

Add `patientId uuid, nullable` to `Account` (tenant-scoped table — belongs in `TENANT_MIGRATIONS`,
matching `Patient` itself), plus a **partial unique index** on `patientId WHERE patientId IS NOT
NULL` — one patient gets at most one portal account. `accountType` continues to gate meaning:
`'staff'` accounts never populate `patientId`; `'patient'` accounts always do (enforced in
`AccountsService`, not just at the DB layer — a `CHECK` alone can't express "populated iff
type='patient'" cleanly with nullable columns, so this is an application-level invariant tested by
an integration spec, same pattern this codebase already uses for tenant status gating).

### 2. Auth — reuse `AuthService`, new guard instead of new permissions

`AuthService.login`/`refresh` (`auth.service.ts:74-273`) stay generic over `Account` — no fork.
The JWT payload (`buildAccessPayload`, `:275-288`) gains `patientId` when `accountType ===
'patient'`. Patients do **not** enter the RBAC roles/permissions catalog
(`seed-rbac-catalog.ts`) — that catalog models staff job functions and has no meaningful concept
for "a patient." Instead, patient-portal controllers sit under their own route prefix
(`/patient-portal/*`) behind a new `PatientAuthGuard` that checks `accountType === 'patient'` on
the JWT and rejects everything else, structurally separate from `PermissionsGuard`. This avoids
inventing fake permission strings in a catalog that's semantically about staff roles.

### 3. Self-scoping is structural, not per-query discipline

Every `/patient-portal/*` read handler takes its `patientId` **only** from the JWT claim set at
login, never from a request parameter or query string. This mirrors the platform-console spec's
established pattern (`2026-08-13-platform-superadmin-console-design.md` §2: isolation as a
property of what the token can resolve to, not a guard that must be remembered per-endpoint) —
applied one level down, from tenant-scope to patient-scope within a tenant. Per the
`tenant-isolation-check` skill, every one of these handlers still also runs inside
`runInTenantSchema` as normal — patient scoping is an *additional* filter layered on top of tenant
scoping, not a replacement for it.

### 4. New frontend app, not a `staff-console` addition

`apps/staff-console` is an internal tool (RBAC-menu-driven, assumes a hospital-staff audience,
plausibly deployed behind stricter network controls). A patient portal is public-internet-facing,
has a completely different login flow (no tenant subdomain routing the way the platform console
uses it), and needs none of the staff shell/sidebar/permission-menu machinery. Generate a new Nx
app `apps/patient-portal` rather than branching `staff-console`'s routing on account type.

### 5. Read-model joins (no code changes to existing entities)

- Appointments, invoices, prescriptions: direct `patientId` FK already exists
  (`appointment.entity.ts`, `invoice.entity.ts:11`, `prescription.entity.ts:10`) — plain filtered
  reads.
- Lab/radiology results have **no direct `patientId`**: `LabRequisition` only has `orderItemId`
  (`lab-requisition.entity.ts`), so a patient's results view must join
  `Order` (has `patientId`, `order.entity.ts:10`) → `LabRequisition`/`RadiologyRequisition` →
  `LabResult`. Worth a dedicated read-service method rather than ad-hoc joins in a controller,
  since Phase 1's whole point is "patient never queries anything staff-shaped directly."

### 6. Invite-based onboarding, not open self-registration

Front-desk staff generate a one-time invite (token tied to an existing `Patient.id`) from the
existing patient record; the patient follows the link and sets their own password. This reuses the
`needsPasswordUpdate` / initial-password-change pattern already built for staff onboarding
(`auth.service.ts` `changeInitialPassword`) rather than inventing a second flow. Open
self-registration is explicitly rejected for Phase 1 — nothing today verifies a self-registering
caller actually *is* the patient they claim to be, and getting that wrong is an identity/PHI
exposure, not a UX nice-to-have.

## Testing Decisions

Phase 1 touches auth and tenant isolation and PHI-shaped data — full `TenantTestContext`
integration specs (this repo's standard for that risk tier), plus `security-review`/`/code-review
high` before merge, per `Development-Standards.md`'s pipeline rule. Explicit negative-case
coverage required: a Patient-A JWT calling a Patient-B-scoped resource id must 404/403, not 200
with wrong data — this is the one property a unit test can't stand in for.

## Out of Scope (Phase 1)

- Appointment booking, bill payment, secure messaging — each needs its own confirmed scope (this
  spec deliberately doesn't design their implementation).
- Guardian/family access to a dependent's chart (minors, elderly dependents) — a real requirement
  for an India hospital market eventually, but a distinct identity-modeling question from "one
  patient, one account."
- Video consults, patient-initiated document upload.
- Multi-tenant patients (the same person as a patient in two different hospitals on this platform)
  — out of scope; each tenant's patient-portal account is independent, matching how `Patient`
  itself is already tenant-scoped with no cross-tenant identity concept.
