# API Gateway / BFF — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§4, §5.1, §6.2, §7, §8 Phase 0)
**Old-system source:** `old/hospital-management-emr/Code/Websites/DanpheEMR/Controllers/*ViewController.cs`, `Controllers/DanpheActionFilter.cs` (`DanpheViewFilter`)

## Correction to the PRD's stated old-system origin

PRD §5.1 describes `Controllers/*ViewController.cs` as a "view-shaped aggregation endpoints" pattern. Reading the actual code: these controllers (`PatientViewController`, `BillingViewController`, etc.) are Razor **partial-view dispatchers** for the Angular app shell — each action just returns `View("SomeTemplate")`, gated by a `[DanpheViewFilter("permission-name")]` attribute. They do **not** aggregate data from multiple bounded contexts; the old monolith never needed to, since one EF context could join any table in-process. There is no old-system precedent for genuine cross-service response aggregation — that part of this service is new work.

What *is* directly reusable is the behavior of `DanpheViewFilter` itself: before invoking an action, it pulls the current user's cached permission list (from session) and checks the action's required permission name against it, redirecting if absent. This is the exact shape of the coarse-grained gate PRD §6.2 already specifies for the Gateway — just moved from a session-lookup to a JWT-claim-lookup.

## Scope

The platform's single ingress point (§7 — no other service is directly internet-facing). Responsibilities: JWT validation, coarse-grained route-level permission gating, rate limiting, request routing/proxying, and response aggregation for UI views that need data from more than one service in a single round trip.

**No dedicated Postgres instance** — unlike every other Phase 0 service, the Gateway is a stateless proxy. Its only stateful dependency is Redis (session/rate-limit counters, per PRD §4). Worth stating explicitly since §4's "one Postgres instance per service" framing could otherwise be read as universal.

## Components

- **JWT validation middleware:** verifies signature/expiry, extracts claims (`sub`, `roles[]`, `permissions[]`, `hospitalId`, `patientId`), attaches to request context. Malformed/expired/invalid tokens are rejected here — never proxied downstream for a backend service to discover.
- **Route→permission mapping — fixed in code per service, not a runtime-editable admin table.** Each of the ~36 backend services declares its own routes' required permissions as versioned config alongside its code (consistent with the decentralization decision already made in the Identity & Access Service design). The Gateway's routing table is assembled from these per-service manifests at build/deploy time. This is a deliberate departure from the old system, where `DanpheRoute` was a live, admin-editable table (a runtime UI could remap which permission gates which URL). The new approach trades that runtime flexibility for safety: a route's required permission is a code change, reviewed via PR and covered by the existing contract-test CI gate (§9.4), not a silent prod edit.
- **Response aggregation (BFF layer):** thin handlers that fan out to multiple backend services (REST or gRPC per §4) and merge results for views that need it — e.g., a patient-summary screen pulling from Patient, Appointment, Billing, and Lab in one call. Each aggregation endpoint gets its own contract test per §9.4, since it depends on multiple backend contracts simultaneously, not just one.
- **Rate limiting:** IP-based at the edge (Redis-backed counters), complementing (not replacing) Identity & Access's per-account lockout — the two are independent layers, one edge-level and one account-level.

## Error handling

- A downstream service timeout or 5xx is surfaced clearly, never silently swallowed.
- **Aggregation endpoints use partial-failure semantics for reads:** if a patient-summary call needs 4 services and one is down, return the 3 that succeeded with an explicit per-section "unavailable" flag rather than failing the whole request. This only applies to read/aggregation endpoints — state-changing operations are never aggregated across services in one Gateway call; a write always targets exactly one owning service (consistent with each service owning its own aggregate roots, §5).

## Testing

- JWT rejection test: expired, malformed, and unsigned tokens must be rejected before any proxying occurs — a request with a bad token must never reach a backend service.
- Route-permission-gate test: a JWT missing a route's required permission is rejected at the Gateway, not forwarded for the backend service to reject (defense in depth, but the coarse gate must actually gate).
- Aggregation partial-failure test: one backend dependency failing must not fail the whole aggregated response for read endpoints.
