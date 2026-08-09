# Frontend UI Revamp (Glassmorphism & Ocean Breeze)

**Status:** Proposed
**Repo:** `new_hospital/frontend` (`apps/staff-console`)

## Problem Statement

The user is dissatisfied with the current UI (which was recently updated to a basic Navy theme). The current UI lacks the "wow" factor, feeling too plain and basic. The user requested a complete UI revamp to make it feel premium, modern, and highly polished, suitable for a state-of-the-art SaaS platform.

## Solution

We will revamp the Angular + PrimeNG UI by completely changing the aesthetic to a **Glassmorphism & Soft** style, anchored by an **Ocean Breeze (Teal & Blue)** gradient color palette.

This direction was chosen interactively via the visual companion:
1. **Layout:** Sidebar & Data-Dense (a classic professional layout with a left sidebar for high information density).
2. **Visual Style:** Glassmorphism & Soft (soft shadows, subtle gradients, rounded corners, backdrop blurs).
3. **Color Palette:** Ocean Breeze (Teal & Blue gradients for primary actions and active states).

## Implementation Decisions

### 1. Theme Configuration (`app.config.ts`)
- Overwrite the existing Navy preset with a new custom preset anchored on a Teal/Blue primary color scale (e.g., `#00c6ff` to `#0072ff`).
- Update global CSS layer orders if necessary, and ensure Tailwind can tap into the new color variables.

### 2. Global CSS & Tailwind (`styles.css` / `tailwind.config.js`)
- Introduce global utility classes for glassmorphic effects (e.g., `.glass-panel` combining `bg-white/70`, `backdrop-blur-md`, `border-white/40`, `shadow-soft`).
- Set a subtle light-gray/blueish background for the main body (`bg-slate-50` or a very faint gradient) to ensure glass effects pop.

### 3. App Shell (`app-shell.component`)
- Restyle the sidebar to use a soft glassmorphic panel or a solid Ocean Breeze gradient instead of the flat dark navy.
- Update active route links to use rounded pills with subtle glows or gradient text.

### 4. Component Restyling
- **Login Screen:** Convert to a floating glass card over a subtle background gradient. Update inputs to be borderless or soft-bordered with blurs.
- **Tenant Management (List & Details):** Update the data tables, buttons, and cards to use the new glass-panel style. Use soft drop shadows instead of harsh borders. Use pill-shaped gradient buttons for primary actions (e.g., "Provision Tenant").
- **Billing/Invoice Screens:** Apply the same soft shadow and rounded-corner aesthetic to invoice summaries and data tables.

## Verification
- Serve the Angular application.
- Verify that the login screen, app shell, and tenant screens reflect the new Glassmorphic style.
- Ensure the Ocean Breeze gradient is used for primary buttons and active states.
