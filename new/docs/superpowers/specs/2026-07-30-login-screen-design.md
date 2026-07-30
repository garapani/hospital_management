# Login Screen — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§6.2); parent specs: `2026-07-30-identity-access-service-design.md`, `2026-07-30-api-gateway-bff-design.md`, `2026-07-30-frontend-framework-architecture-design.md`
**App:** `staff-console` (Angular v18+, per the frontend framework design)

## Scope

The staff login screen — username + password against Identity & Access Service, via the API Gateway. First of the five Phase 0 frontend screens. Patient login (phone + OTP) is out of scope here; it belongs to `patient-portal`, which doesn't activate until Patient Service ships in Phase 1 (per the Identity & Access design).

## Route and fields

`/login` — username (text), password (masked input). No "remember me" checkbox (the old system had one tied to a persistent cookie; the new refresh-token lifetime, per the Identity & Access design, already covers that need without a separate mechanism).

## Token handling

The API Gateway — not the SPA — mediates tokens, consistent with its role as the platform's single ingress (PRD §7):

- On successful login, the Gateway sets the access and refresh tokens as httpOnly, Secure, SameSite=Strict cookies. The frontend never receives or stores a raw JWT string in JS-reachable memory or storage — this closes the XSS token-theft vector that plain localStorage/sessionStorage token storage would leave open.
- Because the SPA can't read an httpOnly cookie, it calls `GET /auth/me` (via the Gateway) immediately after login to fetch non-sensitive claims (display name, `roles[]`, `hospitalId`) as plain JSON. This is used **only** for UI rendering decisions (e.g. hiding a menu item a role can't use) — it is never treated as an authorization source. Actual authorization is enforced server-side on every request regardless of what the UI renders.

## Error states

Matches the error handling already defined in the Identity & Access Service design:

- Invalid username or password → single generic message, never indicates which field was wrong.
- Locked account (5 failed attempts) → distinct message including the retry-after time returned by the backend.
- Gateway/network failure → a generic connectivity error, visually and textually distinct from an authentication failure, so a user doesn't mistake a network outage for a wrong password.

## Submit behavior

Submit button disables and shows a loading state while the request is in flight; the form cannot be submitted again until a response (success or error) is received. This isn't just UX polish — a double-submit bug here would increment the failed-attempt counter twice per real attempt, risking a spurious lockout on a correct password typed under a slow network.

## Post-login redirect

Redirects to a role-appropriate landing page (e.g. Super Admin → Tenant Management screen). Kept simple for now, since Phase 0 has only five screens total; the routing table is expected to grow and be revisited as later phases add more destinations.

## Testing

- E2E: successful login redirects correctly per role.
- E2E: invalid credentials show the generic error, correct message copy.
- E2E: locked account shows the distinct lockout message with retry-after time.
- E2E: rapid double-click/double-submit on the login button results in exactly one login attempt reaching the backend.
