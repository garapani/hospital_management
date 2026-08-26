# Frontend Design Refresh (Navy Theme + Sidebar Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare-PrimeNG-defaults look of `staff-console` with a seeded navy theme and a
persistent dark sidebar shell, and restyle the three screens that already exist (login, invoice
list, invoice detail) to sit inside it — presentation only, no behavior changes.

**Architecture:** A `definePreset(Aura, {...})` navy palette replaces the bare `Aura` preset in
`app.config.ts`. `AppShellComponent` is rebuilt as a fixed dark-navy sidebar + light content area.
The three existing screen templates are restyled to use the new tokens; their component classes
(`.ts` files) are untouched except `invoice-detail.ts`'s `imports` array (swaps `CardModule` for
`ButtonModule`/`TagModule` to match its new template).

**Tech Stack:** Angular 21.2.19, PrimeNG 21.1.9, `@primeuix/themes` 2.0.3 (Aura preset), Tailwind
CSS v4 + `tailwindcss-primeui` 0.6.1 (exposes `bg-primary-{50..950}`, `text-primary-{50..950}`,
`bg-surface-{0..950}` etc. as Tailwind utilities backed by the PrimeNG CSS variables — confirmed in
`node_modules/tailwindcss-primeui/v4/theme/colors.css`), PrimeIcons 8.0.0 (global CSS, no module
import needed — confirmed `pi-receipt` and `pi-arrow-left` exist in the installed icon font).

## Global Constraints

- Navy ramp (exact hex values, copied from the spec — do not regenerate):
  `50:#eef3f9 100:#d9e4f0 200:#b3c9e1 300:#86a8cc 400:#5c86b0 500:#3d668f 600:#2a4f74 700:#173b63 800:#122f50 900:#0d233c 950:#08141f`
- `700` is the exact brand navy — used as `colorScheme.light.primary.color` (buttons/links/active
  state). `900` is the sidebar fill.
- `surface` scale is untouched (PrimeNG's default neutral gray). `darkModeSelector: false` stays.
- Direction: "clean clinical minimal" (Linear/Stripe register) — restrained, high whitespace, one
  accent color used deliberately, not everywhere.
- No new routes, no new backend calls, no new component logic/state. Presentation-only diffs.
- No new npm dependencies — everything needed (`@primeuix/themes`, PrimeIcons, `tailwindcss-primeui`
  Tailwind utilities) is already installed and already wired into `styles.css`/`app.config.ts`.
- Out of scope (do not touch): the 8 remaining Billing mock screens, the 8 non-Billing role screens,
  `new/ui-mocks/*`, a shared design-system lib, dark mode.

---

### Task 1: Seed the navy PrimeNG theme preset

**Files:**
- Modify: `apps/staff-console/src/app/app.config.ts:1-33`

**Interfaces:**
- Consumes: nothing new (existing `providePrimeNG`/`Aura` already imported at lines 5-6).
- Produces: Tailwind utilities `bg-primary-50`…`bg-primary-950`, `text-primary-50`…`text-primary-950`,
  and the semantic `bg-primary`/`text-primary` (which resolve to the new `700` navy) become available
  to every template in the app from this task onward — Tasks 2-5 depend on these class names existing.

- [ ] **Step 1: Replace the `providePrimeNG` config with a navy-seeded preset**

Replace the full contents of `apps/staff-console/src/app/app.config.ts` with:

```typescript
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';
import { API_BASE_URL } from '@org/api-client';
import { authInterceptor, provideAuthBootstrap } from '@org/auth';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';

// Navy ramp anchored on the brand color #173b63 (step 700). See
// new/docs/superpowers/specs/2026-08-09-frontend-design-refresh-design.md for the full rationale —
// this ramp was hand-picked, not generated, and should be redone properly (not hand-extended) if a
// second brand color or a generated-palette tool ever enters the picture.
const MediCareNavyPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: '#eef3f9',
      100: '#d9e4f0',
      200: '#b3c9e1',
      300: '#86a8cc',
      400: '#5c86b0',
      500: '#3d668f',
      600: '#2a4f74',
      700: '#173b63',
      800: '#122f50',
      900: '#0d233c',
      950: '#08141f',
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.700}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.800}',
          activeColor: '{primary.900}',
        },
        highlight: {
          background: '{primary.50}',
          focusBackground: '{primary.100}',
          color: '{primary.700}',
          focusColor: '{primary.800}',
        },
      },
    },
  },
});

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: API_BASE_URL, useValue: environment.apiBaseUrl },
    provideAuthBootstrap(),
    providePrimeNG({
      theme: {
        preset: MediCareNavyPreset,
        options: {
          darkModeSelector: false,
          cssLayer: {
            name: 'primeng',
            order: 'tailwind-base, primeng, tailwind-utilities',
          },
        },
      },
    }),
  ],
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm nx run staff-console:typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/staff-console/src/app/app.config.ts
git commit -m "feat(staff-console): seed navy PrimeNG theme preset"
```

---

### Task 2: Rebuild the app shell as a persistent navy sidebar

**Files:**
- Modify: `apps/staff-console/src/app/shell/app-shell.html`
- Test (unchanged, must still pass): `apps/staff-console/src/app/shell/app-shell.spec.ts` — asserts
  `compiled.querySelector('router-outlet')` is truthy and `compiled.textContent` contains
  `'Invoices'`. Both conditions are preserved by the markup below.

**Interfaces:**
- Consumes: `bg-primary-900`, `text-primary-100`, `bg-surface-50` Tailwind utilities from Task 1.
- Produces: nothing new consumed by later tasks — Tasks 3-5 restyle screens that render *inside*
  `<router-outlet>`, independent of the shell's own markup.

- [ ] **Step 1: Confirm the existing shell test still describes the target behavior**

Run: `pnpm nx run staff-console:test --testPathPattern=app-shell`
Expected: PASS (this is the existing test — confirming it passes *before* the change, so any
failure after Step 2 is attributable to the new markup, not a pre-existing issue).

- [ ] **Step 2: Replace `app-shell.html`**

Replace the full contents of `apps/staff-console/src/app/shell/app-shell.html` with:

```html
<div class="flex min-h-screen">
  <aside class="flex w-60 shrink-0 flex-col bg-primary-900 px-3 py-5 text-white">
    <div class="mb-8 px-3 text-base font-semibold tracking-tight">MediCare OS</div>
    <nav class="flex flex-col gap-1">
      <a
        routerLink="/billing/invoices"
        routerLinkActive="bg-white/10 text-white font-semibold"
        class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-primary-100 hover:bg-white/5"
      >
        <i class="pi pi-receipt text-sm"></i>
        Invoices
      </a>
    </nav>
  </aside>
  <main class="flex-1 bg-surface-50 p-8">
    <router-outlet></router-outlet>
  </main>
</div>
```

- [ ] **Step 3: Run the shell test again**

Run: `pnpm nx run staff-console:test --testPathPattern=app-shell`
Expected: PASS — `router-outlet` still present, `'Invoices'` still in `textContent`.

- [ ] **Step 4: Commit**

```bash
git add apps/staff-console/src/app/shell/app-shell.html
git commit -m "feat(staff-console): rebuild app shell as navy sidebar"
```

---

### Task 3: Restyle the login screen

**Files:**
- Modify: `apps/staff-console/src/app/login/login.html`
- Test (unchanged, must still pass): `apps/staff-console/src/app/login/login.spec.ts` — all 5
  assertions go through `fixture.componentInstance` (form controls, signals), none touch the DOM,
  so this is a template-only change with zero risk to that spec.

**Interfaces:**
- Consumes: `text-primary-700`, `bg-surface-50` Tailwind utilities from Task 1. Consumes the
  unchanged `Login` component's public surface: `form`, `usernameControl`, `passwordControl`,
  `errorMessage()`, `submitting()`, `submit()` — none of these change in this task.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace `login.html`**

Replace the full contents of `apps/staff-console/src/app/login/login.html` with:

```html
<div class="flex min-h-screen items-center justify-center bg-surface-50 p-6">
  <form
    [formGroup]="form"
    (ngSubmit)="submit()"
    class="flex w-full max-w-sm flex-col gap-5 rounded-xl bg-white p-8 shadow-md shadow-surface-200/60"
  >
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold text-primary-700">MediCare OS</h1>
      <p class="text-sm text-surface-500">Staff console sign in</p>
    </div>

    <div class="flex flex-col gap-1">
      <label for="username" class="text-sm text-surface-700">Username</label>
      <input pInputText id="username" formControlName="username" autocomplete="username" />
    </div>

    <div class="flex flex-col gap-1">
      <label for="password" class="text-sm text-surface-700">Password</label>
      <p-password inputId="password" formControlName="password" [feedback]="false" [toggleMask]="true" autocomplete="current-password" />
    </div>

    @if (errorMessage(); as message) {
      <p-message severity="error">{{ message }}</p-message>
    }

    <p-button type="submit" label="Log in" [loading]="submitting()" [disabled]="form.invalid" />
  </form>
</div>
```

- [ ] **Step 2: Run the login tests**

Run: `pnpm nx run staff-console:test --testPathPattern=login`
Expected: PASS (all 5 existing tests).

- [ ] **Step 3: Commit**

```bash
git add apps/staff-console/src/app/login/login.html
git commit -m "feat(staff-console): restyle login screen"
```

---

### Task 4: Restyle the invoice list screen

**Files:**
- Modify: `apps/staff-console/src/app/billing/invoice-list/invoice-list.html`
- Test (unchanged, must still pass): `apps/staff-console/src/app/billing/invoice-list/invoice-list.spec.ts`
  — all 5 assertions go through `fixture.componentInstance` / mocked `InvoicesApiService`, none
  touch the DOM.

**Interfaces:**
- Consumes: `text-primary-700`/`hover:text-primary-800` Tailwind utilities from Task 1. Consumes the
  unchanged `InvoiceList` component's public surface: `invoices()`, `totalRecords()`, `loading()`,
  `patientIdFilter`, `pageSize()`, `firstRecord()`, `reference()`, `statusSeverity()`,
  `onLazyLoad()`, `applyPatientFilter()` — **none of these change**. In particular,
  `statusSeverity()`'s existing mapping (`Paid`→success, `PartiallyPaid`→warn, `Unpaid`→info,
  `Cancelled`→danger, defined in `invoice-list.ts:14-19`) is already correct and is **not** touched
  by this task — only the surrounding template markup changes.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace `invoice-list.html`**

Replace the full contents of `apps/staff-console/src/app/billing/invoice-list/invoice-list.html`
with:

```html
<div class="flex flex-col gap-6">
  <div>
    <h1 class="text-2xl font-semibold text-surface-900">Invoices</h1>
    <p class="text-sm text-surface-500">Filter invoices by patient ID</p>
  </div>

  <div class="flex items-end gap-3">
    <label class="flex flex-col gap-1">
      <span class="text-sm text-surface-700">Patient ID</span>
      <input
        pInputText
        [ngModel]="patientIdFilter()"
        (ngModelChange)="patientIdFilter.set($event)"
        (keyup.enter)="applyPatientFilter()"
        placeholder="Filter by patient ID"
        class="w-64"
      />
    </label>
    <p-button label="Filter" (onClick)="applyPatientFilter()" />
  </div>

  <div class="overflow-hidden rounded-xl border border-surface-200 bg-white">
    <p-table
      [value]="invoices()"
      [lazy]="true"
      [lazyLoadOnInit]="false"
      (onLazyLoad)="onLazyLoad($event)"
      [paginator]="true"
      [rows]="pageSize()"
      [first]="firstRecord()"
      [totalRecords]="totalRecords()"
      [loading]="loading()"
      dataKey="id"
    >
      <ng-template pTemplate="header">
        <tr>
          <th>Reference</th>
          <th>Patient ID</th>
          <th>Total</th>
          <th>Paid</th>
          <th>Status</th>
          <th>Updated</th>
          <th></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-invoice>
        <tr>
          <td>{{ reference(invoice) }}</td>
          <td>{{ invoice.patientId }}</td>
          <td>{{ invoice.totalAmount | number: '1.2-2' }}</td>
          <td>{{ invoice.paidAmount | number: '1.2-2' }}</td>
          <td><p-tag [value]="invoice.status" [severity]="statusSeverity(invoice.status)" /></td>
          <td>{{ invoice.updatedAt | date: 'short' }}</td>
          <td><a [routerLink]="['/billing/invoices', invoice.id]" class="text-sm font-medium text-primary-700 hover:text-primary-800">View</a></td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr><td colspan="7" class="py-8 text-center text-sm text-surface-500">No invoices found.</td></tr>
      </ng-template>
    </p-table>
  </div>
</div>
```

- [ ] **Step 2: Run the invoice list tests**

Run: `pnpm nx run staff-console:test --testPathPattern=invoice-list`
Expected: PASS (all 5 existing tests).

- [ ] **Step 3: Commit**

```bash
git add apps/staff-console/src/app/billing/invoice-list/invoice-list.html
git commit -m "feat(staff-console): restyle invoice list screen"
```

---

### Task 5: Restyle the invoice detail screen

**Files:**
- Modify: `apps/staff-console/src/app/billing/invoice-detail/invoice-detail.html`
- Modify: `apps/staff-console/src/app/billing/invoice-detail/invoice-detail.ts:1-14` (imports array
  only — swaps `CardModule` for `ButtonModule` + `TagModule` to match the new template's components)
- Test (unchanged, must still pass): `apps/staff-console/src/app/billing/invoice-detail/invoice-detail.spec.ts`
  — all 3 assertions go through `fixture.componentInstance.invoice()`/`.error()`, none touch the DOM.

**Interfaces:**
- Consumes: `text-surface-*` Tailwind utilities (already available). Consumes the unchanged
  `InvoiceDetail` component's public surface: `invoice()`, `error()`, `reference()` — none of these
  change. `InvoiceWithReturns.returns` is `InvoiceReturn[]` with fields `id`, `amount`, `reason`
  (from `invoice.model.ts:28-34`) — used as-is.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the component's `imports` array**

In `apps/staff-console/src/app/billing/invoice-detail/invoice-detail.ts`, replace:

```typescript
import { CardModule } from 'primeng/card';
```

with:

```typescript
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
```

and replace the `@Component` decorator's `imports` array:

```typescript
  imports: [DecimalPipe, DatePipe, RouterModule, CardModule],
```

with:

```typescript
  imports: [DecimalPipe, DatePipe, RouterModule, ButtonModule, TagModule],
```

- [ ] **Step 2: Replace `invoice-detail.html`**

Replace the full contents of `apps/staff-console/src/app/billing/invoice-detail/invoice-detail.html`
with:

```html
<div class="flex flex-col gap-6">
  <p-button
    label="Back to invoices"
    icon="pi pi-arrow-left"
    [text]="true"
    routerLink="/billing/invoices"
    class="self-start"
  />

  @if (invoice(); as inv) {
    <div class="flex flex-col gap-6">
      <div class="rounded-xl border border-surface-200 bg-white p-6">
        <div class="flex items-start justify-between">
          <div>
            <div class="text-sm text-surface-500">Invoice</div>
            <div class="text-xl font-semibold text-surface-900">{{ reference(inv) }}</div>
          </div>
          <p-tag [value]="inv.status" />
        </div>
        <div class="mt-6 grid grid-cols-3 gap-4">
          <div>
            <div class="text-xs uppercase tracking-wide text-surface-500">Total</div>
            <div class="text-lg font-semibold text-surface-900">{{ inv.totalAmount | number: '1.2-2' }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-surface-500">Paid</div>
            <div class="text-lg font-semibold text-surface-900">{{ inv.paidAmount | number: '1.2-2' }}</div>
          </div>
          <div>
            <div class="text-xs uppercase tracking-wide text-surface-500">Patient ID</div>
            <div class="text-lg font-semibold text-surface-900">{{ inv.patientId }}</div>
          </div>
        </div>
      </div>

      <div class="rounded-xl border border-surface-200 bg-white p-6">
        <h2 class="mb-4 text-sm font-semibold text-surface-900">Details</h2>
        <dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <dt class="text-surface-500">Invoice ID</dt><dd class="text-surface-900">{{ inv.id }}</dd>
          <dt class="text-surface-500">Subtotal</dt><dd class="text-surface-900">{{ inv.subtotal | number: '1.2-2' }}</dd>
          <dt class="text-surface-500">Discount</dt><dd class="text-surface-900">{{ inv.discountAmount | number: '1.2-2' }}</dd>
          <dt class="text-surface-500">Taxable amount</dt><dd class="text-surface-900">{{ inv.taxableAmount | number: '1.2-2' }}</dd>
          <dt class="text-surface-500">Tax</dt><dd class="text-surface-900">{{ inv.taxAmount | number: '1.2-2' }}</dd>
          <dt class="text-surface-500">Notes</dt><dd class="text-surface-900">{{ inv.notes || '—' }}</dd>
          <dt class="text-surface-500">Created by</dt><dd class="text-surface-900">{{ inv.createdBy }}</dd>
          <dt class="text-surface-500">Created</dt><dd class="text-surface-900">{{ inv.createdAt | date: 'short' }}</dd>
          <dt class="text-surface-500">Updated</dt><dd class="text-surface-900">{{ inv.updatedAt | date: 'short' }}</dd>
        </dl>
      </div>

      <div class="rounded-xl border border-surface-200 bg-white p-6">
        <h2 class="mb-4 text-sm font-semibold text-surface-900">Returns</h2>
        @if (inv.returns.length > 0) {
          <ul class="flex flex-col gap-2 text-sm">
            @for (r of inv.returns; track r.id) {
              <li class="flex items-center justify-between border-b border-surface-100 pb-2 last:border-0 last:pb-0">
                <span class="text-surface-700">{{ r.reason }}</span>
                <span class="font-medium text-surface-900">{{ r.amount | number: '1.2-2' }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="text-sm text-surface-500">No returns.</p>
        }
      </div>
    </div>
  } @else if (error()) {
    <p class="text-sm text-red-600">{{ error() }}</p>
  } @else {
    <p class="text-sm text-surface-500">Loading…</p>
  }
</div>
```

- [ ] **Step 3: Run the invoice detail tests**

Run: `pnpm nx run staff-console:test --testPathPattern=invoice-detail`
Expected: PASS (all 3 existing tests).

- [ ] **Step 4: Commit**

```bash
git add apps/staff-console/src/app/billing/invoice-detail/invoice-detail.ts apps/staff-console/src/app/billing/invoice-detail/invoice-detail.html
git commit -m "feat(staff-console): restyle invoice detail screen"
```

---

### Task 6: Full verification, code review, and closing docs

**Files:**
- Modify: `new/docs/technical-design/Development-Standards.md` (new `## 21.` section)
- Modify: `frontend/CLAUDE.md` (append to "Known scaffold gotchas" / add a design-system note)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing (terminal task).

- [ ] **Step 1: Run the full verification suite**

Run: `pnpm nx run-many --target=typecheck,lint,test,build --all`
Expected: PASS for typecheck/lint/test/build across all 4 projects (`staff-console`,
`staff-console-e2e`, `api-client`, `auth`). If lint reports the pre-existing
`/* eslint-disable */` "unused directive" warnings in `libs/auth/jest.config.cts` /
`libs/api-client/jest.config.cts` (present before this work, unrelated to it — confirmed in the
Angular/PrimeNG downgrade work done earlier the same day), that is expected and not a regression.

- [ ] **Step 2: Manual dev-server check**

Run: `pnpm nx serve staff-console`, open the app in a browser, log in, and click through
Invoices → an invoice's detail page → back. Confirm: navy sidebar renders, active nav item is
highlighted, login card has the new styling, invoice list table renders with colored status tags,
invoice detail shows the new summary-strip + details-card + returns layout. This is a presentation
change with no automated visual regression coverage, so this manual pass is the only check that the
four templates actually render as designed (not just that they compile).

- [ ] **Step 3: Run risk-gated code review**

Per the spec's Testing Decisions: this item is presentation-only (no auth/tenant-isolation/PHI/money
*logic* changes — money is only displayed differently, not computed differently), so it does not
require the `security-review`/`/code-review high` gate. Run `mattpocock-skills:code-review` (Standards
+ Spec axes) against `git diff <commit-before-task-1>...HEAD`, spec at
`new/docs/superpowers/specs/2026-08-09-frontend-design-refresh-design.md`. Fix any findings before
proceeding.

- [ ] **Step 4: Add a Development-Standards.md section**

Append to `new/docs/technical-design/Development-Standards.md` (after the existing `## 20. Billing
Return/Credit-Note` section, matching its heading level/style):

```markdown
## 21. Frontend Theming and Screen Layout

`staff-console`'s visual language (established 2026-08-09, see
`new/docs/superpowers/specs/2026-08-09-frontend-design-refresh-design.md`):

- **Theme:** a `definePreset(Aura, {...})` navy palette in `app.config.ts`, not the bare `Aura`
  preset — `primary.700` (`#173b63`) is the exact brand navy, used via
  `colorScheme.light.primary.color`. The `surface` scale stays PrimeNG's default. Any new brand
  color needs the same `definePreset` treatment, not ad-hoc hex values in templates.
- **Shell:** `AppShellComponent` is a fixed navy (`bg-primary-900`) sidebar + light
  (`bg-surface-50`) content area. New nav entries get added to its `<nav>` list only when the
  screen they point to actually ships — no placeholder links for unbuilt screens.
- **Screen styling:** Tailwind utility classes backed by the `tailwindcss-primeui` plugin
  (`bg-primary-*`, `text-surface-*`, etc. — see `node_modules/tailwindcss-primeui/v4/theme/colors.css`
  for the full list), not raw hex values or a separate CSS file per component. Cards use
  `rounded-xl border border-surface-200 bg-white p-6`; page headers use
  `text-2xl font-semibold text-surface-900` + a `text-sm text-surface-500` subtitle line — reuse
  these exact classes for consistency rather than inventing new spacing/sizing per screen.
- **PrimeIcons:** global CSS (`<i class="pi pi-{name}">`), no Angular module import needed — only
  import a PrimeNG *component* module (`ButtonModule`, `TagModule`, etc.) when using that
  component, not for icons alone.
```

- [ ] **Step 5: Add a CLAUDE.md note**

In `frontend/CLAUDE.md`, under the existing "Known scaffold gotchas" section, add:

```markdown
- **Theming lives in `app.config.ts`, not per-component CSS.** The navy preset
  (`definePreset(Aura, {...})`) seeds every `primary-*`/`surface-*` Tailwind class used across
  screens (via `tailwindcss-primeui`). A new screen should reuse those classes, not introduce a new
  color or a component-local stylesheet. See `new/docs/technical-design/Development-Standards.md`
  §21 for the exact class vocabulary.
```

- [ ] **Step 6: Commit the docs update**

```bash
git add new/docs/technical-design/Development-Standards.md frontend/CLAUDE.md
git commit -m "docs: document frontend theming/shell pattern from design refresh"
```
