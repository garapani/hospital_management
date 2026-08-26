# Tenant Management Screen — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§6.1, §9.1, §10, §12); parent spec: `2026-07-30-system-admin-service-design.md`
**App:** `staff-console` (Angular v18+)

## Scope

Super Admin's platform-level view for onboarding and managing hospital tenants against System Admin Service. Second of the five Phase 0 frontend screens.

**Access control:** Super Admin only. Tenant provisioning is a platform-level, cross-tenant, internal-ops-only action (PRD §9.1/§12 — "no public signup surface"), not something a Hospital Admin needs to see. A Hospital Admin's own hospital-scoped configuration is a separate concern outside this screen and outside Phase 0's five-screen scope.

## Route and list view

`/admin/tenants` — a table of every tenant on the platform: `hospital_id`, `hospital_name`, status.

Status display is not simply active/suspended. While a tenant is mid-provisioning — System Admin's `tenant.schema_ready` acks (per that service's design) haven't reached the full service count yet — the row shows a progress indicator ("Provisioning: 12/35") instead of an active/suspended badge. Only once provisioning completes does the row switch to showing the real active/suspended state.

## Create tenant

A form with a single required input, `hospital_name`. `hospital_id` is auto-suggested as a slug derived from the name, but remains editable before submit.

**Client-side validation is load-bearing here, not cosmetic:** `hospital_id` becomes `tenant_<hospitalId>` — a literal Postgres schema name in 35 services (per PRD §9.1's corrected instance count). It must be validated as lowercase alphanumeric/underscore only *before* submission, not left to fail server-side after the fact. A hospital named "St. Mary's Hospital" producing an unsanitized slug (apostrophe, space) would otherwise become a real provisioning bug, not just a validation nicety.

On submit, the screen calls System Admin Service's tenant-creation endpoint (via the Gateway) and immediately transitions the new row into the provisioning-progress state described above.

## Provisioning status polling

After creation, the screen polls a provisioning-status endpoint every ~3 seconds until the acknowledgment count reaches the full service total, or until a 5-minute timeout is reached — matching the tenant-onboarding NFR in PRD §10. If the timeout is reached without completion, the row shows a distinct "provisioning is taking longer than expected" warning state rather than continuing to poll silently forever with no operator-visible signal that something may be wrong.

## Suspend / Activate

A per-row action, with two constraints:

1. **Disabled while a tenant is still provisioning.** A tenant that hasn't finished being created can't be suspended — there's nothing coherent to suspend yet.
2. **Suspend requires a confirmation dialog**, unlike a typical settings toggle. Per the System Admin Service design, suspending a tenant blocks all of that hospital's staff from logging in going forward. A single misclick on a plain toggle switch should not be able to lock an entire hospital out of the system.

## Error handling

- Duplicate `hospital_id` on create → inline conflict error at the form field, matching System Admin Service's stated "reject with a clear conflict error" behavior — not a generic top-level failure toast that leaves the user unsure which field caused it.

## Testing

- E2E: create a tenant, observe the provisioning-progress indicator update, reach the fully-provisioned state.
- E2E: attempting to create a tenant with a `hospital_id` that already exists shows the inline conflict error.
- E2E: the suspend action requires and respects the confirmation dialog before calling the backend.
- Unit test: the `hospital_id` slug validator rejects spaces, apostrophes, and uppercase characters, and accepts a valid lowercase-alphanumeric-underscore slug.
