# Frontend Design Refresh (Navy Theme + Sidebar Shell) — Design

**Status:** Approved
**Repo:** `new_hospital/frontend` (`apps/staff-console`).
**Depends on:** the Angular 21 / PrimeNG 21 downgrade (2026-08-09, uncommitted at time of writing)
and the existing login/invoice-list/invoice-detail screens from
`2026-08-09-billing-invoice-list-screen-design.md`.
**UI reference:** none of `new/ui-mocks/*` — those prototypes target a different stack (their
READMEs say Next.js + shadcn/ui, this app is Angular + PrimeNG) and are generic/dense wireframes,
not a design to match. This spec defines a fresh visual language instead, validated with the user
via throwaway HTML mockups in `.superpowers/brainstorm/` (not committed, not a reference — the
decisions below are the source of truth).

## Problem Statement

The staff-console app renders, but every screen (login, invoice list, invoice detail) uses bare
PrimeNG defaults with the stock `Aura` preset and ad-hoc Tailwind utility classes — no seeded brand
color, no shared shell beyond a one-line sidebar stub, no consistent spacing/typography treatment.
The user's assessment: "frontend is not good... not elegant." There is no design system to build
new screens against, so each new screen (Billing has 8 more mock-referenced screens alone, plus 8
other roles) would keep compounding the same bare-defaults look.

## Solution

Seed a navy seeded PrimeNG theme, rebuild the app shell as a persistent dark-navy sidebar (icon +
label nav, active-route highlighting), and restyle the three screens that already exist to sit
inside it. No new screens, no new backend calls, no behavior changes — this is presentation only.

Direction was chosen interactively with the user (visual companion, three rounds): "clean clinical
minimal" aesthetic (Linear/Stripe-dashboard register — restrained, high whitespace, one accent
color) over "warm/approachable" or "dense enterprise-admin"; a persistent left sidebar over a
top-tab bar; and a bold-navy-fill sidebar (not a light sidebar with navy-as-accent, not
near-monochrome) as the color treatment.

## User Stories

1. As a staff-console user on any screen, I want a persistent navy sidebar showing my current
   section, so that navigation context is always visible and consistent.
2. As a user logging in, I want the login screen to feel deliberately designed (not a bare bordered
   box), so that the product reads as a real, trustworthy clinical system rather than a scaffold.
3. As Billing/Accounts Staff viewing the invoice list, I want clear visual hierarchy (page header,
   toolbar, status badges with real color meaning) so I can scan and triage quickly.
4. As Billing/Accounts Staff viewing an invoice's detail, I want the key numbers (total, paid,
   status) surfaced prominently instead of buried in an alphabetical `<dl>`, so I can answer "is
   this paid?" at a glance.
5. As the developer building the next screen (Billing's remaining 8, or any other role), I want a
   seeded theme + shell component to build against, so new screens inherit the visual language
   instead of starting from bare PrimeNG defaults again.

## Implementation Decisions

**Theme tokens (`app.config.ts`):**
- Replace the bare `Aura` preset with `definePreset(Aura, { semantic: { primary: {...} } })`, a
  10-step ramp anchored on the brand navy `#173b63`:

  | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
  |---|---|---|---|---|---|---|---|---|---|---|
  | `#eef3f9` | `#d9e4f0` | `#b3c9e1` | `#86a8cc` | `#5c86b0` | `#3d668f` | `#2a4f74` | `#173b63` | `#122f50` | `#0d233c` | `#08141f` |

  `700` is the exact brand navy — used as `colorScheme.light.primary.color` (buttons, active nav,
  links). Sidebar fill uses `900`. `surface` stays PrimeNG's default neutral gray (no change).
- `darkModeSelector: false` and the `cssLayer` config stay as-is — unrelated to this change.

**App shell (`apps/staff-console/src/app/shell/`):**
- `AppShellComponent` rebuilt: sidebar (fixed width, `primary.900` background) with a brand
  wordmark ("MediCare OS") and an icon+label nav list (PrimeIcons, already a dependency — no new
  icon library). Active route highlighted via `routerLinkActive` against a translucent
  white-on-navy background, matching the approved mockup.
- Content area: light neutral background, generous padding, `<router-outlet>` unchanged in
  position/role — this is a restyle of the existing shell, not new routing structure.
- Nav items stay hardcoded to what exists today (Invoices) — no new nav entries invented for
  not-yet-built screens; new entries get added when those screens actually ship.

**Login screen (`login.html`):**
- Keep the centered-card structure and reactive form logic untouched (no behavior change). Restyle
  only: card gets a subtle shadow instead of a flat border, tighter/more deliberate vertical rhythm,
  the "MediCare OS" heading rendered in the new primary color instead of default `surface-900` text.

**Invoice list (`invoice-list.html`):**
- Table/filter/pagination logic untouched (still the same `p-table` lazy-load wiring from the
  existing spec). Restyle only: explicit `p-tag` severity mapping per status (`Paid`→success,
  `Unpaid`→danger, `PartiallyPaid`→warn, `Cancelled`→secondary — currently relies on whatever
  PrimeNG infers by default, which is not guaranteed to match), aligned toolbar spacing, page-header
  treatment consistent with the shell's typography scale.

**Invoice detail (`invoice-detail.html`):**
- Replace the flat two-column `<dl>` with: a summary strip at the top (total amount, paid amount,
  status badge — the three numbers that answer "is this paid?") above a secondary details card for
  the remaining fields (subtotal, discount, tax, notes, audit fields). Returns list restyled as a
  simple list with per-return amount/reason, not a raw `<li>` template. "Back to invoices" becomes a
  proper `p-button` (text/link variant) instead of a bare anchor tag. No new data fetched — same
  `invoice()` signal, same fields, just restructured presentation.

## Testing Decisions

- Pure template/styling change — no new component logic, no new HTTP calls, no new signals/state.
  Existing specs for the login outcome-switch, `InvoicesApiService`, and guards are unaffected.
- Run the existing full suite once at the end; fix any spec that asserts on a CSS class or DOM
  structure that moved (e.g., if a test queries `.border` or specific Tailwind classes rather than
  semantic selectors). No new tests are added since no new observable behavior exists to test.
- Not risk-gated for a dedicated security/PHI review — no auth, tenant-isolation, or money *logic*
  changes (money is only *displayed* differently, not computed differently). Still runs
  `mattpocock-skills:code-review` (Standards + Spec) per the MVP fast-track's "always" rule.

## Out of Scope

- The 8 remaining Billing mock screens (Create Invoice, Payment Collection, etc.) and all 8
  non-Billing role screens — not built yet, get this same visual language applied when they're
  actually implemented, not designed speculatively now.
- Reworking `new/ui-mocks/*` static HTML prototypes — explicitly decided against; they're
  stack-mismatched wireframes, not a target to reconcile.
- A shared design-system library (`libs/ui` or similar) — still only one consuming app; revisit if
  a second Angular app is ever added.
- Dark mode (`darkModeSelector: false` stays as-is).
- Any new screens, routes, backend calls, or behavior changes of any kind.

## Further Notes

The navy ramp above was derived by hand (linear-ish lightness steps anchored on the exact brand
hex) rather than generated via PrimeNG's design-token tooling — close enough for a hand-verified
palette at this scale (one accent color, one app). If a second brand color or a generated-palette
tool ever enters the picture, redo this ramp properly rather than hand-extending it.
