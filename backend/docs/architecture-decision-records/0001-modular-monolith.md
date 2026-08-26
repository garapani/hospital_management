# Modular Monolith Architecture — Design

**Status:** Approved
**Parent PRD:** `new/docs/PRD.md` (§1, §2, §4, §5, §6.2, §7, §8, §9, §10, §11, §12 — all revised 2026-07-31 to match this decision)
**Supersedes:** the microservices architecture this PRD originally locked in (~36 independently-deployed services, one dedicated Postgres instance each), including the five approved Phase 0 design specs written under that assumption (`2026-07-30-api-gateway-bff-design.md`, `2026-07-30-identity-access-service-design.md`, `2026-07-30-master-data-service-design.md`, `2026-07-30-system-admin-service-design.md`, `2026-07-30-audit-service-design.md`).

## Scope

Pivot the whole project (not just new work) from a ~36-service microservices architecture to a single modular monolith: one NestJS application (`apps/api`), one shared Postgres instance for the entire platform, domain boundaries enforced as Nx libraries with lint-gated import rules instead of network/process boundaries. This spec covers the decision and rationale; the actual migration work (renaming `apps/identity-access` → `apps/api`, verifying nothing broke) is a separate implementation plan.

## Rationale

The PRD's own §11 risk register already named this possibility before Phase 0 implementation began: *"a modular monolith could achieve G1–G3 with far less operational complexity (no network hops, no distributed tracing needed)"*, with a stated mitigation of *"explicitly revisit after Phase 1."* Two things justify doing it now, before Phase 1, rather than waiting:

1. **The resource floor was already in tension with the actual hosting plan.** §12's open questions documented a live conflict: the confirmed hosting direction (a mid-tier Hostinger VPS, 16-32GB RAM) is tight against the ~35-Postgres-instance floor the microservices design requires, and that floor hadn't been load-tested. Only one real service (`identity-access`) exists so far — the cheapest point in the project to absorb this change is now, not after 10 more services and their own dedicated Postgres containers exist.
2. **Confirmed scale doesn't need physical isolation.** 10-20 tenants on one self-owned/rented server (§9.1) is squarely single-machine territory. DB-per-service isolation is valuable at a scale where independent deployability and blast-radius containment pay for their operational cost — not confirmed to be true here, and the PRD's own risk register said so from the start.

## What changes vs. the original design

| Concern | Old (microservices) | New (modular monolith) |
|---|---|---|
| Deployable units | ~36 services, ~36 container images | 1 application, 1 container image |
| Postgres | 1 dedicated instance per service (~36 total) | 1 shared instance for the platform |
| Module boundary enforcement | Physical (separate process, separate DB, separate credentials) | Logical (Nx `enforce-module-boundaries` lint tags + code review) |
| Inter-domain calls | REST/gRPC over the network, or RabbitMQ events | Direct in-process NestJS DI |
| Async messaging | RabbitMQ (required) | Dropped for now (YAGNI) — nothing used it yet; revisit only if a genuine cross-process need appears |
| API Gateway/BFF | Separate service, network hop | Folded into `apps/api`'s own controllers — nothing left to route *between* |
| Tenant provisioning | System Admin publishes `tenant.provisioned`; every service consumes it independently, acks `tenant.schema_ready` | One in-process operation: create the tenant row + every module's `tenant_<hospitalId>` schema, in the same transaction/request |
| RBAC cache invalidation | `rbac.changed` event over RabbitMQ | Direct in-process call |

## What this does *not* change

- **Tenancy model:** still schema-per-tenant (`tenant_<hospitalId>`), same `@hospital/tenant-context` middleware, same Postgres role-level schema grants for tenant isolation. Unaffected by this pivot.
- **RBAC model:** same roles (§6.1), same JWT claims shape, same `@hospital/auth-guards` library and `PermissionGuard`/`@RequirePermission` pattern already built and shipped in `apps/identity-access`.
- **The old system's actual root problem is not reintroduced.** §1's Problem Statement calls out *unenforced* bounded contexts and free-for-all shared-DB access as Danphe EMR's real issue — not merely being one deployable. This design keeps strict per-module data ownership (G2) and a hard CI gate against cross-module imports; only the *physical* instance-per-service separation is dropped.

## Isolation trade-off (explicit, not hidden)

Collapsing to one process and one Postgres instance genuinely weakens isolation compared to the original design:

- **Before:** a bug that tried to query another domain's tables would fail at the connection level — there was no shared instance to misconfigure.
- **After:** that same bug compiles and runs; only Nx's `enforce-module-boundaries` lint rule and code review stand between a careless import and a real cross-module leak.
- **Before:** one domain's crash or bad deploy couldn't take down another domain.
- **After:** the whole application shares fate — one module's crash is an outage for all of them.

Both are recorded as accepted trade-offs in PRD §10/§11, not silently dropped. The mitigation is process, not infrastructure: a hard CI lint gate (§9.4) plus normal code review discipline, sized to a small team at 10-20 tenants — revisit if either risk starts actually biting.

## Migration scope (the restructuring work itself)

This spec is the architecture decision. The mechanical migration is a separate implementation plan covering:

1. Rename `apps/identity-access` → `apps/api` (directory, `package.json` name, jest/tsconfig project references, CI workflow, `docker-compose.dev.yml` service/container name — keeping port `5433` to avoid unrelated churn).
2. Run the full existing test suite + typecheck after the rename to confirm nothing broke. No entity/table changes, no new business logic — this is a pure identity rename.
3. Existing code inside the app (accounts/, auth/, rbac/, database/) already reads as domain modules; no internal restructuring needed as part of this pass.

Not in scope for that plan: Nx module-boundary lint configuration (§12 open question #6 — needed before a second domain module like System Admin is added, but a separate follow-up), and revising the five Phase 0 design specs that assumed RabbitMQ/per-service provisioning (System Admin's spec is the one that actually needs rework; the other four are largely unaffected since they never depended on the event-driven provisioning flow).

## Testing

- No new business-logic tests — this is an infrastructure/naming change.
- Verification is the existing `apps/identity-access` (post-rename `apps/api`) test suite passing unchanged, plus a typecheck pass, after the rename.
