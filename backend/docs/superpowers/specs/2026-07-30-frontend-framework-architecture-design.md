# Frontend Framework & Architecture — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§3, §9.4 — frontend framework explicitly deferred to a separate repo/decision, not fixed by the PRD)
**Old-system source (constraints only, not carried forward as a framework choice):** `old/hospital-management-emr/Code/Websites/DanpheEMR/wwwroot/DanpheApp/package.json`

## Old-system context

The old app is Angular 7.1.0 (pre-Ivy, EOL) using Angular Material + `ag-grid-angular` + Bootstrap 4 + Chart.js + `ngx-webcam`/`ngx-image-cropper`. Confirms the real UI shape this system needs: heavy data-grid tables (billing, lab, pharmacy), dashboards, and webcam-based patient photo capture at registration — not a marketing-site-style app. This informs constraints on the new build below; the old app itself is not being upgraded or reused (PRD §3/§12 already resolved this as a full greenfield rebuild).

## Decisions

**Framework:** Angular, modern (v18+). Chosen for team familiarity with the framework family (not a code-level continuation of the old app — full rebuild) and because it's batteries-included (forms, router, DI) for an admin/forms-heavy application.

**Workspace structure:** Nx workspace containing two independently deployable applications, sharing common libraries (API client, auth interceptor, design tokens):
- `staff-console` — dense, data-grid-heavy screens (billing, lab, pharmacy, clinical, admin).
- `patient-portal` — lightweight, mobile-friendly, OTP-login self-service portal.

Rationale: the two have fundamentally different UI/performance profiles (per PRD §6.1's role model — staff vs. Patient role). A single app with role-based routing would force the patient-portal bundle to carry staff-console weight it never uses.

**Rendering mode:** Client-side rendering only, no SSR. Both apps sit behind authentication (staff always; patient after OTP verification per the Identity & Access design) — there's no anonymous-crawler or first-paint-for-SEO need that SSR exists to solve.

**State management:** Angular v18 native signals for component/app state. No NgRx adopted upfront — YAGNI; revisit only if cross-cutting global-state complexity genuinely demands it once real screens are built.

**UI component library:** Deliberately deferred, not decided here. To be chosen when building the first genuinely data-grid-heavy screen (likely a Billing or Lab results table), where the real requirements (column grouping, large datasets, pivoting) are concrete rather than abstract.

**Multi-tenancy:** One shared `staff-console` build serves every hospital in hosted mode (PRD §9.1) — no per-tenant frontend build or deploy. `hospitalId` is resolved from the JWT after login (per the Identity & Access Service design); tenant branding (logo, colors) is fetched at runtime from System Admin Service's per-tenant `hospital_settings` table (already designed), not baked into the build per tenant.

**API access:** Both apps call the API Gateway only — never a backend service directly (PRD §7, "no service is directly internet-facing"). `staff-console` authenticates via username/password against Identity & Access; `patient-portal` via phone + OTP, per that service's already-approved design.

## Carried-over requirement, not yet designed

Webcam-based patient photo capture at registration (old app used `ngx-webcam`/`ngx-image-cropper`) is a real requirement for the new `staff-console`, confirmed by old-code inspection. Specific library/implementation choice is deferred to when that registration screen is designed — same treatment as the UI component library decision above, not dropped.

## Testing

- End-to-end tests (e.g. Playwright) covering the login flow for both apps once built.
- Shared libraries (API client, auth interceptor) get component-level tests independent of either app, since both apps depend on them.
