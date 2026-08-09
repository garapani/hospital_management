# Billing Invoice List Screen — Design

**Status:** Approved
**Repo:** `new_hospital/frontend` (`apps/staff-console`).
**Depends on:** `libs/api-client`, `libs/auth` (built 2026-08-09, spec
`2026-08-09-frontend-shared-libs-api-client-auth-design.md`).
**UI reference:** `new/ui-mocks/billing_staff_visual/screens/02-invoice-list.html` — IA/pattern
reference only (toolbar+search+table shape, permission-aware footer). Field-level content is
generic placeholder, not real design; permission strings shown are invented (real gating is the
single coarse `billing.manage` permission — see Implementation Decisions).

## Problem Statement

`staff-console` has no working screens yet — `libs/api-client`/`libs/auth` exist but nothing calls
them, and there's no login screen, so nothing in the app can be manually verified against the real
backend. Billing staff need to see a paginated list of invoices to do their job, and building that
requires (as a hard prerequisite) a way to actually log in first.

## Solution

A minimal login screen, a `billing.manage`-gated route guard, and a Billing Invoice List screen
backed by the real `GET /billing/invoices` endpoint (paginated, optional `patientId` filter). A
row-level "View" action navigates to a placeholder invoice-detail route that renders the raw
invoice fields — proving the click-through works end-to-end without building the full Invoice
Details screen (mock screens 04-06), which is its own future unit of work.

## User Stories

1. As a staff-console user, I want a login form (username/password), so that I can obtain a
   session and access any protected screen.
2. As a staff-console user with invalid credentials, I want a clear inline error message, so that
   I know to retry rather than seeing a silent failure.
3. As a staff-console user whose account is locked, I want to see the lockout message with the
   retry time, so that I understand why login is failing and when to try again.
4. As a user without the `billing.manage` permission, I want to be blocked from `/billing/invoices`
   (redirected away), so that the UI enforces the same boundary the backend already enforces.
5. As Billing/Accounts Staff, I want to see a paginated table of invoices (reference, patient ID,
   total, paid, status, updated), so that I can find and triage invoices without scrolling one
   giant list.
6. As Billing/Accounts Staff, I want to filter the list by patient ID, so that I can see just one
   patient's invoices (e.g. arriving from a patient's chart in the future).
7. As Billing/Accounts Staff, I want each invoice's status shown as a clear visual badge (Unpaid /
   PartiallyPaid / Paid / Cancelled), so that I can triage at a glance.
8. As Billing/Accounts Staff, I want to click an invoice row and see its full detail (even in
   placeholder form today), so that the list isn't a dead end.
9. As a developer building the next screen, I want a shared app-shell layout (persistent sidebar
   nav + router-outlet), so that I don't rebuild navigation chrome per screen.

## Implementation Decisions

**Routing & shell:**
- `appRoutes` gains: `/login` (public), `/billing/invoices` (list, guarded), `/billing/invoices/:id`
  (placeholder detail, guarded). Root path redirects to `/billing/invoices`.
- A minimal `AppShellComponent` (sidebar nav + `<router-outlet>` in the main area) wraps the
  guarded routes as a parent route with children — matches the mock's persistent-sidebar pattern.
  `/login` renders outside the shell (no nav chrome before authentication).
- **`authGuard`** (`CanActivateFn`, exported from `@org/auth` alongside `authInterceptor` — same
  library, same reasoning as `provideAuthBootstrap()`): redirects to `/login` if
  `!authService.isAuthenticated()`. A **separate** `permissionGuard(permission: string)` factory
  (also from `@org/auth`) redirects to `/login` if `!authService.hasPermission(permission)` —
  kept distinct from `authGuard` because some future routes may need "logged in" without a specific
  permission (e.g. a landing/dashboard page). Route-level only; the backend's `PermissionGuard`
  remains the actual authorization boundary, this is UX (no dead-end blank screens).

**Login screen (`apps/staff-console/src/app/login/`):**
- Standalone component, reactive form (username, password), PrimeNG `InputText` + `Password` +
  `Button`. Calls `AuthService.login()`, switches on the three-way `LoginOutcome`
  (`success` → navigate to `/billing/invoices`; `locked` → show "Account locked, retry in Ns";
  `invalidCredentials` → show "Invalid username or password"). No "remember me" / SSO / password
  reset — genuinely out of scope, not in the backend's `auth.controller.ts` surface either.

**Invoice List screen (`apps/staff-console/src/app/billing/invoice-list/`):**
- Standalone component, injects `ApiClientService` directly (a small dedicated
  `InvoicesApiService` wrapping the two real calls — `list`/`findOne` — is the actual seam, so the
  component itself doesn't touch `ApiClientService` directly; keeps the same "component talks to a
  thin per-domain service, not the generic client" shape the codebase will want as more screens are
  added).
- `InvoicesApiService.list(params: { patientId?: string; page?: number; limit?: number })` calls
  `GET /billing/invoices` and returns the real `{ data: Invoice[]; total: number; page: number;
  limit: number }` shape (confirmed from `invoices.service.ts:202-218` in the backend — **not**
  the newer `libs/pagination` `PaginatedResponseDto` shape other backend modules are migrating to;
  Billing hasn't been migrated yet, so the frontend must match what's actually deployed today, not
  the newer convention).
- `PrimeNG p-table` with `[lazy]="true"` + `(onLazyLoad)` + `[paginator]="true"`, server-side
  pagination (each page turn is a real HTTP call) — establishes the lazy-paginated-table pattern
  for future data-grid-heavy screens (Billing is the first genuinely data-grid-heavy screen per the
  original frontend architecture spec's deferred "choose it when building the first one" decision).
- Columns: Invoice reference (composed client-side as `${financialYear}-${invoiceNumber}`, zero
  real "reference" field exists on the backend entity), Patient ID (raw UUID — no patient-name
  join exists yet, this is a known/deferred gap, not silently hidden), Total, Paid, Status (`p-tag`,
  colored by the real 4-value status enum: Unpaid/PartiallyPaid/Paid/Cancelled — not the mock's
  invented Ready/Pending/Urgent), Updated (`updatedAt`), a "View" link per row.
- Toolbar: a single "Patient ID" text filter (the only server-supported filter today) that
  re-triggers the lazy load at page 1. The mock's free-text search and status-dropdown filter are
  **not implemented** — the backend doesn't support them yet (`invoices.service.ts`'s `list()` only
  accepts `patientId`), and client-side-only filtering of a single page would be misleading given
  server-side pagination. Noted as a backend gap, not silently dropped.
- "Create invoice" / "Collect payment" / "Record deposit" / "Refund" toolbar buttons from the mock
  are **not implemented** — those are separate screens (03, 05, 07, 08) not in scope here.

**Invoice Detail placeholder (`apps/staff-console/src/app/billing/invoice-detail/`):**
- Standalone component, route param `:id`, calls `InvoicesApiService.findOne(id)`, renders the raw
  `Invoice` fields (including its `returns: Return[]` array) in a plain PrimeNG `p-card` — no
  payment collection, no formatted layout matching mock screens 04-06. Explicitly a placeholder;
  the real Invoice Details screen is future work.

## Testing Decisions

- Seams: `InvoicesApiService` (HTTP interaction — `HttpTestingController`, matching the
  `libs/api-client`/`libs/auth` pattern already established), the login component's outcome-switch
  behavior (component test asserting the right message renders per `LoginOutcome` variant, using a
  fake `AuthService`), and `authGuard`/`permissionGuard` (unit tests against a fake `AuthService` +
  `Router`, matching `libs/auth`'s existing guard-adjacent test style).
- The list/detail components' template rendering (table columns, pagination wiring) gets lighter
  smoke-level component tests (renders without error, calls the API service on init) — not
  exhaustive PrimeNG-internals testing, per this repo's existing "test only at pre-agreed seams"
  discipline; PrimeNG's own table/pagination mechanics aren't this codebase's code to test.
- This item touches money (Billing) and auth (login/guards) — full risk-gated review applies per
  the MVP fast-track's risk-gating rule, same as the Billing Return feature.

## Out of Scope

- Full Invoice Details screen (mock 04), Payment Collection (05), Payment History (06), Create
  Invoice (03), Deposits (07), Refunds (08), Receipts (09), Outstanding Dues (10), Billing Settings
  (11) — each is its own future screen/spec.
- Free-text invoice search, status-dropdown filtering, patient-name display — blocked on backend
  support that doesn't exist yet (`invoices.service.ts` only filters by exact `patientId`, no
  patient-name join).
- "Remember me", SSO, password reset, MFA — no backend support, not in `auth.controller.ts`.
- Design-tokens shared library (still deferred, unrelated to this screen).
- Route-level code-splitting/lazy-loading of feature modules — premature at 2-3 routes total.

## Further Notes

The two DTO-shape families in this backend (Billing's raw `{data,total,page,limit}` vs. the newer
`libs/pagination` `PaginatedResponseDto` other modules are migrating to) mean `InvoicesApiService`
cannot be a fully generic "paginated list" wrapper reused as-is once Billing itself migrates —
noted here so that future migration doesn't get treated as a surprise breaking change on the
frontend side.
